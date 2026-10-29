// Operações do editor de mapas que não dependem da tela: copiar e colar, encaixe na grade,
// simetria aplicada a objetos já colocados, "selecionar iguais", fileiras e áreas de
// decorações, bases distribuídas em modelos prontos, pontos das linhas (rios, serras…) e a
// camada de construção (onde dá para construir). Tudo puro: os testes rodam no Node.

import type { Edits, PlacedProp, Pt, Relief, SculptOp } from "../studio/mapEdit.ts";
import { distAt, walkDistances, walkMask, type Feature, type Grid, type Symmetry } from "./worldgen.ts";

/** Um mapa como o editor guarda (só o que estas operações usam). */
export interface OpsDoc { edits: Edits; features: Feature[] }
type SymOp = { pt: (p: Pt) => Pt; m: [number, number, number, number] };

const r1 = (v: number) => Math.round(v * 10) / 10;
const kindOf = (s: string) => s.split(":")[0];
const idxOf = (s: string) => Number(s.split(":")[1]);

// ------------------------------------------------------------------ encaixe na grade

export const SNAP_STEPS = [0, 4, 8, 16, 32] as const;
export const snapPt = (q: Pt, step: number): Pt => (step > 0 ? [Math.round(q[0] / step) * step, Math.round(q[1] / step) * step] : q);

// ------------------------------------------------------------------ copiar e colar

export type ClipItem =
  | { k: "spawn"; p: Pt } | { k: "mass"; p: Pt } | { k: "prop"; q: PlacedProp } | { k: "cut"; c: [number, number, number] }
  | { k: "bridge"; b: [number, number, number, number] } | { k: "relief"; r: Relief } | { k: "feat"; f: Feature };
/** Objetos copiados, com as posições relativas ao centro da seleção. */
export interface Clip { items: ClipItem[]; at: number }

function shiftOp(op: SculptOp, dx: number, dz: number): SculptOp {
  const o = [...op] as SculptOp;
  if (o[0] === "disc" || o[0] === "cone") { o[1] = r1(o[1] + dx); o[2] = r1(o[2] + dz); }
  else { o[1] = r1(o[1] + dx); o[2] = r1(o[2] + dz); o[3] = r1(o[3] + dx); o[4] = r1(o[4] + dz); }
  return o;
}

/** Centro de um objeto (para o centro da seleção). */
export function itemCenter(d: OpsDoc, id: string): Pt | null {
  const e = d.edits, i = idxOf(id);
  switch (kindOf(id)) {
    case "spawn": return e.spawns[i] ?? null;
    case "mass": return e.mass[i] ?? null;
    case "prop": return e.props[i] ? [e.props[i].x, e.props[i].z] : null;
    case "cut": return e.cuts[i] ? [e.cuts[i][0], e.cuts[i][1]] : null;
    case "bridge": { const b = e.bridges[i]; return b ? [(b[0] + b[1]) / 2, (b[2] + b[3]) / 2] : null; }
    case "relief": {
      const op = e.relief[i]?.op;
      if (!op) return null;
      return op[0] === "disc" || op[0] === "cone" ? [op[1], op[2]] : [(op[1] + op[3]) / 2, (op[2] + op[4]) / 2];
    }
    case "feat": {
      const f = d.features.find((x) => x.id === id.slice(5));
      if (!f) return null;
      return [f.pts.reduce((a, q) => a + q[0], 0) / f.pts.length, f.pts.reduce((a, q) => a + q[1], 0) / f.pts.length];
    }
  }
  return null;
}

export function copySel(d: OpsDoc, ids: string[]): Clip | null {
  const pts = ids.map((s) => itemCenter(d, s)).filter((q): q is Pt => !!q);
  if (!pts.length) return null;
  const cx = pts.reduce((a, q) => a + q[0], 0) / pts.length, cz = pts.reduce((a, q) => a + q[1], 0) / pts.length;
  const rel = (q: Pt): Pt => [r1(q[0] - cx), r1(q[1] - cz)];
  const items: ClipItem[] = [];
  const e = d.edits;
  for (const s of ids) {
    const i = idxOf(s);
    switch (kindOf(s)) {
      case "spawn": if (e.spawns[i]) items.push({ k: "spawn", p: rel(e.spawns[i]) }); break;
      case "mass": if (e.mass[i]) items.push({ k: "mass", p: rel(e.mass[i]) }); break;
      case "prop": if (e.props[i]) { const q = e.props[i]; items.push({ k: "prop", q: { ...q, x: r1(q.x - cx), z: r1(q.z - cz), gen: false } }); } break;
      case "cut": if (e.cuts[i]) { const [x, z, r] = e.cuts[i]; items.push({ k: "cut", c: [r1(x - cx), r1(z - cz), r] }); } break;
      case "bridge": if (e.bridges[i]) { const [x0, x1, z0, z1] = e.bridges[i]; items.push({ k: "bridge", b: [r1(x0 - cx), r1(x1 - cx), r1(z0 - cz), r1(z1 - cz)] }); } break;
      case "relief": if (e.relief[i]) items.push({ k: "relief", r: { ...e.relief[i], op: shiftOp(e.relief[i].op, -cx, -cz) } }); break;
      case "feat": {
        const f = d.features.find((x) => x.id === s.slice(5));
        if (f) items.push({ k: "feat", f: { ...f, gen: false, pts: f.pts.map((q) => rel(q)) } });
      }
    }
  }
  return items.length ? { items, at: Date.now() } : null;
}

export interface PasteLimits { spawns: number; mass: number; props: number; cuts: number }

/** Cola o que foi copiado com o centro em `at`. Devolve o mapa novo e os ids colados. */
export function pasteClip<D extends OpsDoc>(d: D, clip: Clip, at: Pt, grid: number, lim: PasteLimits, newId: () => string): [D, string[]] {
  const [cx, cz] = at;
  const cl = (v: number) => Math.max(0, Math.min(grid, r1(v)));
  const e = d.edits;
  const n: Edits = { ...e, spawns: [...e.spawns], mass: [...e.mass], props: [...e.props], cuts: [...e.cuts], bridges: [...e.bridges], relief: [...e.relief] };
  const feats = [...d.features];
  const out: string[] = [];
  for (const it of clip.items) {
    if (it.k === "spawn" && n.spawns.length < lim.spawns) { n.spawns.push([cl(it.p[0] + cx), cl(it.p[1] + cz)]); out.push(`spawn:${n.spawns.length - 1}`); }
    else if (it.k === "mass" && n.mass.length < lim.mass) { n.mass.push([cl(it.p[0] + cx), cl(it.p[1] + cz)]); out.push(`mass:${n.mass.length - 1}`); }
    else if (it.k === "prop" && n.props.length < lim.props) { n.props.push({ ...it.q, x: r1(it.q.x + cx), z: r1(it.q.z + cz) }); out.push(`prop:${n.props.length - 1}`); }
    else if (it.k === "cut" && n.cuts.length < lim.cuts) { n.cuts.push([cl(it.c[0] + cx), cl(it.c[1] + cz), it.c[2]]); out.push(`cut:${n.cuts.length - 1}`); }
    else if (it.k === "bridge") { const [x0, x1, z0, z1] = it.b; n.bridges.push([cl(x0 + cx), cl(x1 + cx), cl(z0 + cz), cl(z1 + cz)]); out.push(`bridge:${n.bridges.length - 1}`); }
    else if (it.k === "relief") { n.relief.push({ ...it.r, op: shiftOp(it.r.op, cx, cz) }); out.push(`relief:${n.relief.length - 1}`); }
    else if (it.k === "feat") {
      const f: Feature = { ...it.f, id: newId(), pts: it.f.pts.map(([x, z]) => [Math.round(cl(x + cx)), Math.round(cl(z + cz))] as Pt) };
      feats.push(f);
      out.push(`feat:${f.id}`);
    }
  }
  return [{ ...d, edits: n, features: feats }, out];
}

// ------------------------------------------------------------------ simetria aplicada à seleção

const near = (a: Pt, b: Pt, tol: number) => Math.hypot(a[0] - b[0], a[1] - b[1]) < tol;
const mapYawM = (yaw: number, m: [number, number, number, number]) => {
  const a = (yaw * Math.PI) / 180, dx = Math.cos(a), dz = Math.sin(a);
  return Math.round(((Math.atan2(m[2] * dx + m[3] * dz, m[0] * dx + m[1] * dz) * 180) / Math.PI + 360) % 360);
};
const inv = (m: [number, number, number, number]): [number, number, number, number] => {
  const det = m[0] * m[3] - m[1] * m[2] || 1;
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det];
};
const mul = (a: [number, number, number, number], b: [number, number, number, number]): [number, number, number, number] =>
  [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3]];

function mirrorOp(op: SculptOp, o: SymOp): SculptOp {
  if (op[0] === "disc" || op[0] === "cone") { const [x, z] = o.pt([op[1], op[2]]); const c = [...op] as SculptOp; c[1] = r1(x); c[2] = r1(z); return c; }
  const [ax, az] = o.pt([op[1], op[2]]), [bx, bz] = o.pt([op[3], op[4]]);
  const c = [...op] as SculptOp;
  c[1] = r1(Math.min(ax, bx)); c[2] = r1(Math.min(az, bz)); c[3] = r1(Math.max(ax, bx)); c[4] = r1(Math.max(az, bz));
  if (op[0] === "ramp" && c[0] === "ramp") {
    // a ponta baixa da rampa (lado da coordenada menor) pode ir para o outro lado
    const alongX = Math.abs(op[3] - op[1]) >= Math.abs(op[4] - op[2]);
    const lowEnd: Pt = alongX ? [Math.min(op[1], op[3]), (op[2] + op[4]) / 2] : [(op[1] + op[3]) / 2, Math.min(op[2], op[4])];
    const lt = o.pt(lowEnd), nAlongX = c[3] - c[1] >= c[4] - c[2];
    const mid = nAlongX ? (c[1] + c[3]) / 2 : (c[2] + c[4]) / 2;
    if ((nAlongX ? lt[0] : lt[1]) > mid) { const lo = c[5]; c[5] = c[6]; c[6] = lo; }
  }
  return c;
}

/** Repete a seleção nos outros lados da simetria. Copia só o que ainda não tem par lá. */
export function symmetrizeSel<D extends OpsDoc>(d: D, ids: string[], ops: SymOp[], grid: number, lim: PasteLimits, newId: () => string): [D, string[]] {
  if (ops.length < 2) return [d, []];
  const cl = (v: number) => Math.max(0, Math.min(grid, r1(v)));
  const e = d.edits;
  const n: Edits = { ...e, spawns: [...e.spawns], mass: [...e.mass], props: [...e.props], cuts: [...e.cuts], bridges: [...e.bridges], relief: [...e.relief] };
  const feats = [...d.features];
  const out: string[] = [];
  for (const s of ids) {
    const i = idxOf(s), k = kindOf(s);
    for (const o of ops.slice(1)) {
      const tp = (q: Pt): Pt => { const c = o.pt(q); return [cl(c[0]), cl(c[1])]; };
      if (k === "spawn" && e.spawns[i]) {
        const q = tp(e.spawns[i]);
        if (!n.spawns.some((x) => near(x, q, 6)) && n.spawns.length < lim.spawns) { n.spawns.push(q); out.push(`spawn:${n.spawns.length - 1}`); }
      } else if (k === "mass" && e.mass[i]) {
        const q = tp(e.mass[i]);
        if (!n.mass.some((x) => near(x, q, 4)) && n.mass.length < lim.mass) { n.mass.push(q); out.push(`mass:${n.mass.length - 1}`); }
      } else if (k === "prop" && e.props[i]) {
        const src = e.props[i];
        const [x, z] = o.pt([src.x, src.z]);
        if (!n.props.some((x2) => x2.bp === src.bp && near([x2.x, x2.z], [x, z], 1.5)) && n.props.length < lim.props) {
          n.props.push({ ...src, x: r1(x), z: r1(z), yaw: mapYawM(src.yaw, o.m), gen: false });
          out.push(`prop:${n.props.length - 1}`);
        }
      } else if (k === "cut" && e.cuts[i]) {
        const [x, z, r] = e.cuts[i], q = tp([x, z]);
        if (!n.cuts.some((c) => near([c[0], c[1]], q, 3)) && n.cuts.length < lim.cuts) { n.cuts.push([q[0], q[1], r]); out.push(`cut:${n.cuts.length - 1}`); }
      } else if (k === "bridge" && e.bridges[i]) {
        const [x0, x1, z0, z1] = e.bridges[i], a = tp([x0, z0]), b = tp([x1, z1]);
        const nb: [number, number, number, number] = [Math.min(a[0], b[0]), Math.max(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[1], b[1])];
        if (!n.bridges.some((x) => near([(x[0] + x[1]) / 2, (x[2] + x[3]) / 2], [(nb[0] + nb[1]) / 2, (nb[2] + nb[3]) / 2], 4))) { n.bridges.push(nb); out.push(`bridge:${n.bridges.length - 1}`); }
      } else if (k === "relief" && e.relief[i]) {
        const op = mirrorOp(e.relief[i].op, o);
        const c = itemCenter({ edits: { ...n, relief: [{ ...e.relief[i], op }] }, features: [] }, "relief:0")!;
        if (!n.relief.some((r, j) => r.kind === e.relief[i].kind && near(itemCenter({ edits: n, features: [] }, `relief:${j}`)!, c, 4))) { n.relief.push({ ...e.relief[i], op }); out.push(`relief:${n.relief.length - 1}`); }
      } else if (k === "feat") {
        const f = d.features.find((x) => x.id === s.slice(5));
        if (!f) continue;
        const pts = f.pts.map((q) => o.pt(q).map((v) => Math.round(cl(v))) as Pt);
        const dup = feats.some((g) => g.kind === f.kind && g.pts.length === pts.length && (g.pts.every((q, j) => near(q, pts[j], 5)) || g.pts.every((q, j) => near(q, pts[pts.length - 1 - j], 5))));
        if (dup) continue;
        // a forma copiada vê o mundo pela matriz da cópia: o relevo sai espelhado de verdade
        const m = mul(f.m ?? [1, 0, 0, 1], inv(o.m));
        const c: Feature = { ...f, id: newId(), pts, m, gen: false, name: undefined };
        feats.push(c);
        out.push(`feat:${c.id}`);
      }
    }
  }
  return [{ ...d, edits: n, features: feats }, out];
}

/** Objetos sem par do outro lado da simetria (para a validação). */
export function symmetryGaps(d: OpsDoc, ops: SymOp[]): string[] {
  if (ops.length < 2) return [];
  const out: string[] = [];
  const has = (list: Pt[], q: Pt, tol: number) => list.some((x) => near(x, q, tol));
  d.edits.spawns.forEach((p, i) => { if (ops.slice(1).some((o) => !has(d.edits.spawns, o.pt(p), 12))) out.push(`spawn:${i}`); });
  d.edits.mass.forEach((p, i) => { if (ops.slice(1).some((o) => !has(d.edits.mass, o.pt(p), 8))) out.push(`mass:${i}`); });
  return out;
}

// ------------------------------------------------------------------ selecionar iguais e inverter

/** Objetos do mesmo tipo do escolhido (mesma decoração, mesma forma, todas as bases…). */
export function similarTo(d: OpsDoc, id: string): string[] {
  const k = kindOf(id), i = idxOf(id), e = d.edits;
  if (k === "prop") { const bp = e.props[i]?.bp; return e.props.flatMap((q, j) => (q.bp === bp ? [`prop:${j}`] : [])); }
  if (k === "feat") { const f = d.features.find((x) => x.id === id.slice(5)); return f ? d.features.filter((x) => x.kind === f.kind).map((x) => `feat:${x.id}`) : []; }
  if (k === "relief") { const kind = e.relief[i]?.kind; return e.relief.flatMap((r, j) => (r.kind === kind ? [`relief:${j}`] : [])); }
  const list: unknown[] = k === "spawn" ? e.spawns : k === "mass" ? e.mass : k === "cut" ? e.cuts : k === "bridge" ? e.bridges : [];
  return list.map((_, j) => `${k}:${j}`);
}

export function allIds(d: OpsDoc): string[] {
  const e = d.edits;
  return [
    ...e.spawns.map((_, i) => `spawn:${i}`), ...e.mass.map((_, i) => `mass:${i}`), ...e.props.map((_, i) => `prop:${i}`),
    ...e.cuts.map((_, i) => `cut:${i}`), ...e.bridges.map((_, i) => `bridge:${i}`), ...e.relief.map((_, i) => `relief:${i}`),
    ...d.features.map((f) => `feat:${f.id}`),
  ];
}

// ------------------------------------------------------------------ decorações em fileira e em área

export interface ScatterRules { ok: (x: number, z: number) => boolean; rand?: () => number }

/** Decorações espaçadas por `gap` ao longo do segmento a→b (cercas, muros, fileiras de árvores). */
export function rowProps(a: Pt, b: Pt, gap: number, bp: string, sizeVar: number, rules: ScatterRules, align = true): PlacedProp[] {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const n = Math.max(1, Math.floor(L / Math.max(2, gap)) + 1);
  const yaw = Math.round(((Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI + 360) % 360);
  const rnd = rules.rand ?? Math.random;
  const out: PlacedProp[] = [];
  for (let k = 0; k < n; k++) {
    const t = n === 1 ? 0 : k / (n - 1);
    const x = r1(a[0] + (b[0] - a[0]) * t), z = r1(a[1] + (b[1] - a[1]) * t);
    if (!rules.ok(x, z)) continue;
    out.push({ bp, x, z, yaw: align ? yaw : Math.round(rnd() * 360), scale: Math.round(Math.max(0.3, 1 + (rnd() * 2 - 1) * (sizeVar / 100)) * 100) / 100 });
  }
  return out;
}

/** Preenche o retângulo a–b com `perK` decorações a cada 100×100 (sem encostar umas nas outras). */
export function fillProps(a: Pt, b: Pt, perK: number, bps: string[], sizeVar: number, rules: ScatterRules, max = 1500): PlacedProp[] {
  const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), z0 = Math.min(a[1], b[1]), z1 = Math.max(a[1], b[1]);
  const area = (x1 - x0) * (z1 - z0);
  const want = Math.min(max, Math.round((area / 10000) * perK));
  const rnd = rules.rand ?? Math.random;
  // distância mínima pela densidade: espalha de forma natural (sem bolos nem fileiras)
  const minD = Math.max(1.5, Math.sqrt(10000 / Math.max(1, perK)) * 0.45);
  const cell = minD, cols = Math.max(1, Math.ceil((x1 - x0) / cell)), grid = new Map<number, Pt[]>();
  const key = (x: number, z: number) => Math.floor((z - z0) / cell) * (cols + 2) + Math.floor((x - x0) / cell);
  const out: PlacedProp[] = [];
  for (let tries = 0; out.length < want && tries < want * 12; tries++) {
    const x = r1(x0 + rnd() * (x1 - x0)), z = r1(z0 + rnd() * (z1 - z0));
    const k0 = key(x, z);
    let close = false;
    for (const dk of [0, -1, 1, -(cols + 2), cols + 2, -(cols + 3), -(cols + 1), cols + 1, cols + 3]) {
      if (grid.get(k0 + dk)?.some((q) => near(q, [x, z], minD))) { close = true; break; }
    }
    if (close || !rules.ok(x, z)) continue;
    grid.set(k0, [...(grid.get(k0) ?? []), [x, z]]);
    out.push({ bp: bps[Math.floor(rnd() * bps.length) % bps.length], x, z, yaw: Math.round(rnd() * 360), scale: Math.round(Math.max(0.3, 1 + (rnd() * 2 - 1) * (sizeVar / 100)) * 100) / 100 });
  }
  return out;
}

// ------------------------------------------------------------------ bases em modelos prontos

export type SpawnLayout = "circle" | "corners" | "lines" | "sides";
export const SPAWN_LAYOUTS: { id: SpawnLayout; label: string; icon: string; hint: string }[] = [
  { id: "circle", label: "Em círculo", icon: "radio_button_unchecked", hint: "Todas à mesma distância do centro (todos contra todos ou times em metades)." },
  { id: "corners", label: "Nos cantos", icon: "crop_free", hint: "Cantos e meio das bordas, o mais longe possível umas das outras." },
  { id: "lines", label: "Frente a frente", icon: "view_agenda", hint: "Um time em cima e o outro embaixo, como nos mapas competitivos de times." },
  { id: "sides", label: "Lado a lado", icon: "view_column", hint: "Um time à esquerda e o outro à direita." },
];

/** Posições das bases e a simetria que combina com elas. As bases vão em sequência por time. */
export function spawnLayout(kind: SpawnLayout, n: number, grid: number, margin = 0.14): { spawns: Pt[]; symmetry: Symmetry } {
  const G = grid, m = Math.max(40, G * margin), c = G / 2;
  const pts: Pt[] = [];
  if (kind === "circle") {
    const R = c - m;
    // começa no alto à esquerda: com 2 times, as metades ficam em lados opostos
    for (let i = 0; i < n; i++) { const a = Math.PI * 1.25 + (i / n) * Math.PI * 2; pts.push([r1(c + Math.cos(a) * R), r1(c + Math.sin(a) * R)]); }
    return { spawns: pts, symmetry: n % 4 === 0 ? "rot4" : n % 2 === 0 ? "rot2" : "none" };
  }
  if (kind === "corners") {
    const lo = m, hi = G - m;
    const ring: Pt[] = [[lo, lo], [c, lo], [hi, lo], [hi, c], [hi, hi], [c, hi], [lo, hi], [lo, c]];
    // 2: cantos opostos; 4: os quatro cantos; 8: cantos e meios; outros: espalhadas pela volta
    const order = n === 2 ? [0, 4] : n === 4 ? [0, 2, 4, 6] : n === 8 ? [0, 1, 2, 3, 4, 5, 6, 7] : null;
    if (order) for (const k of order) pts.push(ring[k]);
    else for (let i = 0; i < n; i++) pts.push(ring[Math.round((i * 8) / n) % 8]);
    return { spawns: pts.map((q) => [r1(q[0]), r1(q[1])] as Pt), symmetry: n === 4 || n === 8 ? "rot4" : n % 2 === 0 ? "rot2" : "none" };
  }
  const a = Math.ceil(n / 2), b = n - a;
  const row = (k: number, total: number) => (total === 1 ? c : m + ((G - 2 * m) * k) / (total - 1));
  for (let i = 0; i < a; i++) pts.push(kind === "lines" ? [r1(row(i, a)), r1(m)] : [r1(m), r1(row(i, a))]);
  // o outro time na mesma ordem espelhada (cada base tem uma rival bem na frente)
  for (let i = 0; i < b; i++) pts.push(kind === "lines" ? [r1(row(i, b)), r1(G - m)] : [r1(G - m), r1(row(i, b))]);
  return { spawns: pts, symmetry: a === b ? (kind === "lines" ? "mirror-z" : "mirror-x") : "none" };
}

// ------------------------------------------------------------------ pontos das linhas

/** Curva mais suave (Chaikin), mantendo as pontas. */
export function smoothLine(pts: Pt[], max = 40): Pt[] {
  if (pts.length < 3) return pts;
  const out: Pt[] = [pts[0]];
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    if (i > 0) out.push([Math.round(ax * 0.75 + bx * 0.25), Math.round(az * 0.75 + bz * 0.25)]);
    if (i < pts.length - 2) out.push([Math.round(ax * 0.25 + bx * 0.75), Math.round(az * 0.25 + bz * 0.75)]);
  }
  out.push(pts[pts.length - 1]);
  return out.length > max ? simplifyLine(out, Math.max(3, max)) : out;
}

/** Menos pontos: tira os que quase não mudam a direção da linha. */
export function simplifyLine(pts: Pt[], keep = Math.max(2, Math.ceil(pts.length / 2))): Pt[] {
  const cur = pts.slice();
  const cost = (i: number) => {
    const [ax, az] = cur[i - 1], [bx, bz] = cur[i], [cx, cz] = cur[i + 1];
    return Math.abs((bx - ax) * (cz - az) - (bz - az) * (cx - ax)) / 2;
  };
  while (cur.length > Math.max(2, keep)) {
    let bi = 1, bc = Infinity;
    for (let i = 1; i < cur.length - 1; i++) { const c = cost(i); if (c < bc) { bc = c; bi = i; } }
    cur.splice(bi, 1);
  }
  return cur;
}

/** Ponto da linha mais perto de `q` (para arrastar um ponto só). */
export function nearestVertex(pts: Pt[], q: Pt, max: number): number {
  let bi = -1, bd = max;
  pts.forEach((p, i) => { const dd = Math.hypot(p[0] - q[0], p[1] - q[1]); if (dd <= bd) { bd = dd; bi = i; } });
  return bi;
}

/** Ponto novo no trecho da linha mais perto de `q`. Devolve a linha e o índice do ponto novo. */
export function insertVertex(pts: Pt[], q: Pt): [Pt[], number] {
  let bi = 0, bd = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const vx = bx - ax, vz = bz - az, l2 = vx * vx + vz * vz || 1;
    const t = Math.max(0, Math.min(1, ((q[0] - ax) * vx + (q[1] - az) * vz) / l2));
    const dd = Math.hypot(q[0] - ax - vx * t, q[1] - az - vz * t);
    if (dd < bd) { bd = dd; bi = i; }
  }
  const out = pts.slice();
  out.splice(bi + 1, 0, [Math.round(q[0]), Math.round(q[1])]);
  return [out, bi + 1];
}

// ------------------------------------------------------------------ camada de construção

export const BUILD_KEY = [
  { color: "#3fb950", label: "Plano: cabe qualquer prédio" },
  { color: "#d4c34a", label: "Suave: unidades passam, prédios pequenos" },
  { color: "#e5843b", label: "Íngreme: só passa" },
  { color: "#c93c3c", label: "Paredão: ninguém passa a pé" },
  { color: "#2f6fb3", label: "Água" },
] as const;

/** Tipo de cada ponto (0 plano … 3 paredão, 4 água), a sombra do relevo e a altura, em px × px. */
export function buildCells(size: number, grid: number, H: Float32Array, water: number, hasWater: boolean, maxSlope: number, px: number) {
  const s = size, w = s + 1, step = grid / s;
  const cls = new Uint8Array(px * px), shade = new Float32Array(px * px), hgt = new Float32Array(px * px);
  // a mesma inclinação que a navegação do editor usa para dizer por onde as tropas passam
  const pass = Math.max(0.35, maxSlope * 0.5);
  const sample = (fi: number, fj: number) => {
    const i = Math.max(0, Math.min(s - 1, Math.floor(fi))), j = Math.max(0, Math.min(s - 1, Math.floor(fj)));
    const u = Math.max(0, Math.min(1, fi - i)), v = Math.max(0, Math.min(1, fj - j)), k = j * w + i;
    return (H[k] * (1 - u) + H[k + 1] * u) * (1 - v) + (H[k + w] * (1 - u) + H[k + w + 1] * u) * v;
  };
  for (let y = 0; y < px; y++) for (let x = 0; x < px; x++) {
    const fi = (x / (px - 1)) * s, fj = (y / (px - 1)) * s;
    const h = sample(fi, fj), d = 0.75;
    const gx = (sample(fi + d, fj) - sample(fi - d, fj)) / (2 * d * step), gz = (sample(fi, fj + d) - sample(fi, fj - d)) / (2 * d * step);
    const sl = Math.hypot(gx, gz), o = y * px + x;
    cls[o] = hasWater && h <= water ? 4 : sl < 0.08 ? 0 : sl < 0.3 ? 1 : sl < pass ? 2 : 3;
    shade[o] = Math.max(0.62, Math.min(1.18, 1 - gx * 0.6 - gz * 0.4));
    hgt[o] = h;
  }
  return { cls, shade, hgt };
}

/**
 * Pixels RGBA da camada de construção: verde onde dá para construir, amarelo onde passa,
 * vermelho nos paredões, azul na água, com o relevo sombreado e curvas de nível a cada `contour`.
 */
export function buildPixels(size: number, grid: number, H: Float32Array, water: number, hasWater: boolean, maxSlope: number, px: number, contour = 8): Uint8ClampedArray {
  const { cls, shade, hgt } = buildCells(size, grid, H, water, hasWater, maxSlope, px);
  const hexes = BUILD_KEY.map((k) => [parseInt(k.color.slice(1, 3), 16), parseInt(k.color.slice(3, 5), 16), parseInt(k.color.slice(5, 7), 16)]);
  const out = new Uint8ClampedArray(px * px * 4);
  for (let y = 0; y < px; y++) for (let x = 0; x < px; x++) {
    const o = y * px + x, c = cls[o];
    let [r, g, b] = hexes[c];
    // curva de nível: escurece onde a altura cruza um múltiplo de `contour`
    if (contour > 0 && c !== 4 && x < px - 1 && y < px - 1) {
      const band = Math.floor(hgt[o] / contour);
      if (band !== Math.floor(hgt[o + 1] / contour) || band !== Math.floor(hgt[o + px] / contour)) { r *= 0.45; g *= 0.45; b *= 0.45; }
    }
    const sh = c === 4 ? 1 : shade[o];
    out[o * 4] = r * sh; out[o * 4 + 1] = g * sh; out[o * 4 + 2] = b * sh; out[o * 4 + 3] = 255;
  }
  return out;
}

/** Quanto do mapa é de cada tipo (plano, suave, íngreme, paredão, água), de 0 a 1. */
export function buildShares(size: number, grid: number, H: Float32Array, water: number, hasWater: boolean, maxSlope: number): number[] {
  const px = Math.min(256, size);
  const { cls } = buildCells(size, grid, H, water, hasWater, maxSlope, px);
  const n = [0, 0, 0, 0, 0];
  for (const c of cls) n[c]++;
  return n.map((v) => v / cls.length);
}

/** Relevo em tons de cinza (8 bits, do mais baixo ao mais alto) para exportar como PNG. */
export function heightPixels(size: number, H: Float32Array, px: number): { data: Uint8ClampedArray; lo: number; hi: number } {
  const s = size, w = s + 1;
  let lo = Infinity, hi = -Infinity;
  for (const v of H) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  const span = Math.max(1e-3, hi - lo), out = new Uint8ClampedArray(px * px * 4);
  for (let y = 0; y < px; y++) for (let x = 0; x < px; x++) {
    const i = Math.round((x / (px - 1)) * s), j = Math.round((y / (px - 1)) * s);
    const g = Math.round(((H[j * w + i] - lo) / span) * 255), o = (y * px + x) * 4;
    out[o] = out[o + 1] = out[o + 2] = g; out[o + 3] = 255;
  }
  return { data: out, lo, hi };
}

// ------------------------------------------------------------------ prévia dos marcadores da IA

export type AiKind = "Land Path Node" | "Air Path Node" | "Expansion Area" | "Large Expansion Area" | "Attack Marker" | "Defensive Point"
  | "Rally Point" | "Protected Experimental Construction" | "Combat Zone";
export const AI_STYLE: Record<AiKind, { color: string; label: string; r: number }> = {
  "Land Path Node": { color: "#7bd88f", label: "Caminho por terra", r: 5 },
  "Air Path Node": { color: "#e8eef4", label: "Caminho pelo ar", r: 4 },
  "Expansion Area": { color: "#2ec4b6", label: "Expansão", r: 16 },
  "Large Expansion Area": { color: "#ff4fa3", label: "Expansão grande", r: 22 },
  "Attack Marker": { color: "#b06cff", label: "Alvo de ataque", r: 9 },
  "Defensive Point": { color: "#3fb950", label: "Ponto de defesa", r: 10 },
  "Rally Point": { color: "#d4c34a", label: "Ponto de encontro", r: 10 },
  "Protected Experimental Construction": { color: "#4f7bff", label: "Experimentais protegidos", r: 12 },
  "Combat Zone": { color: "#e5534b", label: "Zona de combate", r: 26 },
};
export interface AiMarker { kind: AiKind; x: number; z: number }

/**
 * Os mesmos marcadores que o toolkit põe no mapa ao gerar (resources/maptk/cp_aimarkers.py), para
 * ver no editor antes. `height` e `dry` leem o relevo do editor.
 */
export function aiMarkers(height: (x: number, z: number) => number, dry: (x: number, z: number) => boolean, G: number, spawns: Pt[], mass: Pt[]): AiMarker[] {
  const k = G / 1024, cx = G / 2, cz = G / 2;
  const inside = (x: number, z: number, m = 24) => x >= m && x <= G - m && z >= m && z <= G - m;
  const walkable = (x: number, z: number, r = 4) => {
    if (!inside(x, z) || !dry(x, z)) return false;
    const y = height(x, z);
    return [[r, 0], [-r, 0], [0, r], [0, -r]].every(([dx, dz]) => Math.abs(height(x + dx, z + dz) - y) < r * 0.9);
  };
  const snap = (x: number, z: number, reach = 24): Pt | null => {
    x = Math.round(x); z = Math.round(z);
    if (walkable(x, z)) return [x, z];
    for (let rad = 4; rad <= reach; rad += 4) for (let a = 0; a < 360; a += 30) {
      const px = Math.round(x + Math.cos((a * Math.PI) / 180) * rad), pz = Math.round(z + Math.sin((a * Math.PI) / 180) * rad);
      if (walkable(px, pz)) return [px, pz];
    }
    return null;
  };
  const out: AiMarker[] = [];
  const add = (kind: AiKind, x: number, z: number, gap = 0) => {
    if (gap && out.some((u) => u.kind === kind && Math.hypot(u.x - x, u.z - z) < gap)) return;
    out.push({ kind, x, z });
  };
  const step = Math.max(48, Math.round(80 * k));
  for (let z = step >> 1; z < G; z += step) for (let x = step >> 1; x < G; x += step) { const q = snap(x, z, Math.floor(step / 3)); if (q) add("Land Path Node", q[0], q[1]); }
  const air = Math.max(80, Math.round(128 * k));
  for (let z = air >> 1; z < G; z += air) for (let x = air >> 1; x < G; x += air) add("Air Path Node", x, z);
  const far = mass.filter((m) => spawns.every((s) => Math.hypot(m[0] - s[0], m[1] - s[1]) > 40 * k));
  const groups: Pt[][] = [];
  for (const m of far) {
    const g = groups.find((gg) => gg.some((q) => Math.hypot(m[0] - q[0], m[1] - q[1]) < 45 * k));
    if (g) g.push(m); else groups.push([m]);
  }
  for (const g of groups) {
    const gx = g.reduce((a, q) => a + q[0], 0) / g.length, gz = g.reduce((a, q) => a + q[1], 0) / g.length;
    const q = snap(gx, gz) ?? [Math.round(g[0][0]), Math.round(g[0][1])] as Pt;
    add("Expansion Area", q[0], q[1]);
    if (g.length >= 3) add("Large Expansion Area", q[0], q[1]);
    add("Attack Marker", q[0], q[1]);
    const d = snap(gx + 14 * k, gz + 14 * k);
    if (d) add("Defensive Point", d[0], d[1]);
  }
  for (const [sx, sz] of spawns) {
    const a = Math.atan2(cz - sz, cx - sx);
    for (const [d, kind] of [[30, "Rally Point"], [-34, "Protected Experimental Construction"]] as const) {
      const q = snap(sx + Math.cos(a) * d * k, sz + Math.sin(a) * d * k);
      if (q) add(kind, q[0], q[1]);
    }
    for (const da of [-0.6, 0.6]) { const q = snap(sx + Math.cos(a + da) * 48 * k, sz + Math.sin(a + da) * 48 * k); if (q) add("Defensive Point", q[0], q[1]); }
    add("Attack Marker", Math.round(sx), Math.round(sz));
  }
  const c = snap(cx, cz, 60);
  if (c) add("Combat Zone", c[0], c[1]);
  spawns.forEach((s, i) => {
    const others = spawns.filter((_, j) => j !== i);
    if (!others.length) return;
    const t = others.reduce((b, q) => (Math.hypot(q[0] - s[0], q[1] - s[1]) < Math.hypot(b[0] - s[0], b[1] - s[1]) ? q : b));
    const q = snap((s[0] + t[0]) / 2, (s[1] + t[1]) / 2, 40);
    if (q) add("Combat Zone", q[0], q[1], 50 * k);
  });
  return out;
}

// ------------------------------------------------------------------ massa disputada

/**
 * Pontos de massa que ficam a uma distância parecida (a pé) de bases de times diferentes: é onde
 * os jogadores vão brigar. Devolve os índices da massa.
 */
export function contestedMass(g: Grid, H: Float32Array, water: number, hasWater: boolean, spawns: Pt[], mass: Pt[], teamOf: (i: number) => number, tol = 0.18): number[] {
  if (spawns.length < 2 || !mass.length) return [];
  const mask = walkMask(g, H, water, hasWater);
  const dists = spawns.map((p) => walkDistances(g, mask, p));
  const out: number[] = [];
  mass.forEach((m, i) => {
    const ds = dists.map((d, j) => ({ d: distAt(g, d, m), team: teamOf(j) })).filter((x) => x.d >= 0).sort((a, b) => a.d - b.d);
    if (ds.length < 2 || ds[0].d < 40 / (g.grid / g.size)) return; // colada numa base: é dela
    const rival = ds.find((x) => x.team !== ds[0].team);
    if (rival && rival.d <= ds[0].d * (1 + tol)) out.push(i);
  });
  return out;
}

// ------------------------------------------------------------------ peças prontas

export interface Piece { id: string; name: string; clip: Clip; builtin?: boolean }

const ring = (n: number, r: number, a0 = 0): Pt[] => Array.from({ length: n }, (_, i) => [r1(Math.cos(a0 + (i / n) * Math.PI * 2) * r), r1(Math.sin(a0 + (i / n) * Math.PI * 2) * r)] as Pt);
const feat = (kind: Feature["kind"], pts: Pt[], r: number, h: number, name?: string): ClipItem =>
  ({ k: "feat", f: { id: "", kind, pts, r, h, rough: kind === "pad" ? 0 : 0.5, seed: 11, ...(name ? { name } : {}) } });

/** Peças que já vêm com o editor (as que você guarda ficam junto). */
export const BUILTIN_PIECES: Piece[] = [
  { id: "b-exp3", name: "Expansão (3 massas)", builtin: true, clip: { at: 0, items: [feat("pad", [[0, 0]], 34, 0, "Expansão"), ...ring(3, 11, -Math.PI / 2).map((p) => ({ k: "mass", p }) as ClipItem)] } },
  { id: "b-exp5", name: "Expansão grande (5 massas)", builtin: true, clip: { at: 0, items: [feat("pad", [[0, 0]], 46, 0, "Expansão"), ...ring(5, 18).map((p) => ({ k: "mass", p }) as ClipItem)] } },
  { id: "b-hill", name: "Platô com massa", builtin: true, clip: { at: 0, items: [feat("plateau", [[0, 0]], 62, 22), ...ring(2, 14).map((p) => ({ k: "mass", p }) as ClipItem)] } },
  { id: "b-crater", name: "Cratera com massa no meio", builtin: true, clip: { at: 0, items: [feat("crater", [[0, 0]], 80, 14), ...ring(3, 10).map((p) => ({ k: "mass", p }) as ClipItem)] } },
  { id: "b-pass", name: "Desfiladeiro entre duas serras", builtin: true, clip: { at: 0, items: [
    feat("ridge", [[-120, -40], [-40, -40]], 26, 46), feat("ridge", [[40, 40], [120, 40]], 26, 46), feat("pass", [[-60, 60], [60, -60]], 30, 0),
  ] } },
  { id: "b-lake", name: "Lago com ilha", builtin: true, clip: { at: 0, items: [feat("lake", [[0, 0]], 110, 10), feat("island", [[0, 0]], 40, 18)] } },
];
