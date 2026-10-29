// Operações novas do editor de mapas (src/pages/create/mapEditOps.ts e mapStats.ts).
// node --experimental-strip-types tools/test_mapeditops.ts
import {
  aiMarkers, allIds, BUILTIN_PIECES, buildShares, contestedMass, copySel, fillProps, insertVertex, nearestVertex, pasteClip, rowProps, similarTo, simplifyLine, smoothLine, snapPt,
  spawnLayout, symmetrizeSel, symmetryGaps, type OpsDoc,
} from "../src/pages/create/mapEditOps.ts";
import { compareCompetitive, mapStats } from "../src/pages/create/mapStats.ts";
import { symmetryOps } from "../src/pages/create/worldgen.ts";
import type { Pt } from "../src/pages/studio/mapEdit.ts";
import { combinePaint, newPaint, paintDab, paintT, paintTRegion } from "../src/pages/studio/biome.ts";

let fails = 0;
const check = (c: boolean, m: string) => { if (!c) { fails++; console.log("FALHOU:", m); } else console.log("ok  ", m); };
const G = 1024;
const LIM = { spawns: 16, mass: 200, props: 5000, cuts: 400 };
let seq = 0;
const nid = () => `t${seq++}`;
const base = (): OpsDoc => ({
  edits: {
    spawns: [[200, 200]], mass: [[230, 210], [260, 200]], bridges: [[100, 140, 300, 320]], seed: null, cuts: [[400, 400, 20]], reskin: {},
    relief: [{ kind: "ramp", op: ["ramp", 300, 500, 380, 530, 10, 30, "set"] }, { kind: "hill", op: ["cone", 600, 600, 40, 50, "raise"] }],
    props: [{ bp: "/props/a.bp", x: 120, z: 130, yaw: 0, scale: 1 }, { bp: "/props/a.bp", x: 140, z: 130, yaw: 90, scale: 1 }, { bp: "/props/b.bp", x: 160, z: 130, yaw: 0, scale: 1 }],
  } as OpsDoc["edits"],
  features: [{ id: "f1", kind: "river", pts: [[100, 700], [300, 760], [500, 720]], r: 20, h: 8, rough: 0.5, seed: 3 }, { id: "f2", kind: "mountain", pts: [[800, 300]], r: 60, h: 40, rough: 0.5, seed: 2 }],
});

// encaixe
check(snapPt([13, 27], 8).join() === "16,24" && snapPt([13, 27], 0).join() === "13,27", "encaixe na grade");

// copiar e colar: posições relativas preservadas, ids novos nas formas
{
  const d = base();
  const clip = copySel(d, ["spawn:0", "mass:0", "prop:0", "feat:f2", "relief:1"])!;
  check(clip.items.length === 5, "copia 5 objetos");
  const [n, ids] = pasteClip(d, clip, [700, 700], G, LIM, nid);
  check(ids.length === 5 && n.edits.spawns.length === 2 && n.edits.mass.length === 3 && n.features.length === 3, "cola 5 objetos");
  const ds = [n.edits.spawns[1][0] - d.edits.spawns[0][0], n.edits.spawns[1][1] - d.edits.spawns[0][1]];
  const dm = [n.edits.mass[2][0] - d.edits.mass[0][0], n.edits.mass[2][1] - d.edits.mass[0][1]];
  check(Math.abs(ds[0] - dm[0]) < 0.2 && Math.abs(ds[1] - dm[1]) < 0.2, "a seleção colada mantém as distâncias entre os objetos");
  check(n.features[2].id !== "f2" && n.features[2].kind === "mountain", "forma colada ganha id novo");
  const op = n.edits.relief[2].op;
  check(op[0] === "cone" && Math.abs(op[1] - 600 - ds[0]) < 0.2, "relevo colado anda junto");
  check(d.edits.spawns.length === 1, "o original não muda");
}

// simetria aplicada à seleção (giro de 180°)
{
  const d = base();
  const ops = symmetryOps("rot2", G);
  const [n, made] = symmetrizeSel(d, allIds(d), ops, G, LIM, nid);
  check(n.edits.spawns.some((q) => Math.hypot(q[0] - 824, q[1] - 824) < 0.5), "base copiada do outro lado");
  check(n.edits.props.find((q) => Math.hypot(q.x - 904, q.z - 894) < 0.5)?.yaw === 180, "decoração copiada gira junto");
  const ramp = n.edits.relief.find((r, i) => i >= 2 && r.op[0] === "ramp")!.op;
  check(ramp[0] === "ramp" && ramp[1] === 644 && ramp[3] === 724 && ramp[5] === 30 && ramp[6] === 10, `rampa espelhada sobe para o lado certo: ${JSON.stringify(ramp)}`);
  const river = n.features.find((f) => f.kind === "river" && f.id !== "f1")!;
  check(!!river && river.pts[0][0] === 924 && !!river.m && river.m.every((v, i) => Math.abs(v - [-1, 0, 0, -1][i]) < 1e-9), `rio espelhado com a matriz da cópia: ${JSON.stringify(river?.m)}`);
  check(symmetryGaps(d, ops).length === 3 && symmetryGaps(n, ops).length === 0, "validação acha o que está sem par e para de achar depois");
  const [, again] = symmetrizeSel(n, allIds(n), ops, G, LIM, nid);
  check(made.length > 8 && again.length === 0, `aplicar de novo não duplica (${made.length} cópias, depois ${again.length})`);
  const [n4] = symmetrizeSel(d, ["spawn:0"], symmetryOps("rot4", G), G, LIM, nid);
  check(n4.edits.spawns.length === 4, "giro de 90° faz 4 bases");
}

// selecionar iguais
{
  const d = base();
  check(similarTo(d, "prop:0").join() === "prop:0,prop:1", "decorações iguais");
  check(similarTo(d, "mass:1").length === 2 && similarTo(d, "feat:f1").join() === "feat:f1", "massa e formas do mesmo tipo");
}

// fileira e área
{
  const row = rowProps([0, 0], [100, 0], 10, "/p.bp", 0, { ok: () => true });
  check(row.length === 11 && row.every((q) => q.yaw === 0) && row[10].x === 100, `fileira de 11 alinhada (${row.length})`);
  const holes = rowProps([0, 0], [100, 0], 10, "/p.bp", 0, { ok: (x) => x < 50 });
  check(holes.length === 5, "fileira pula onde não pode");
  let s0 = 7;
  const rand = () => ((s0 = (s0 * 16807) % 2147483647) / 2147483647);
  const fill = fillProps([0, 0], [200, 200], 40, ["/a.bp", "/b.bp"], 20, { ok: () => true, rand });
  let minD = Infinity;
  for (let i = 0; i < fill.length; i++) for (let j = i + 1; j < fill.length; j++) minD = Math.min(minD, Math.hypot(fill[i].x - fill[j].x, fill[i].z - fill[j].z));
  check(fill.length >= 120 && fill.length <= 160 && minD >= 7, `área cheia sem encostar (${fill.length} decorações, menor distância ${minD.toFixed(1)})`);
  check(fill.some((q) => q.bp === "/a.bp") && fill.some((q) => q.bp === "/b.bp"), "área mistura os modelos");
}

// bases em modelos prontos
for (const [kind, n] of [["circle", 4], ["circle", 6], ["corners", 4], ["corners", 8], ["lines", 6], ["sides", 4], ["circle", 5]] as const) {
  const r = spawnLayout(kind, n, G);
  const inside = r.spawns.every((q) => q[0] > 40 && q[1] > 40 && q[0] < G - 40 && q[1] < G - 40);
  const ops = symmetryOps(r.symmetry, G);
  const sym = r.spawns.every((q) => ops.every((o) => r.spawns.some((x) => Math.hypot(x[0] - o.pt(q)[0], x[1] - o.pt(q)[1]) < 1)));
  let gap = Infinity;
  r.spawns.forEach((a, i) => r.spawns.forEach((b, j) => { if (j > i) gap = Math.min(gap, Math.hypot(a[0] - b[0], a[1] - b[1])); }));
  check(r.spawns.length === n && inside && sym && gap > 150, `${kind} ${n}: dentro do mapa, simetria ${r.symmetry}, distância mínima ${Math.round(gap)}`);
}
{
  const r = spawnLayout("lines", 6, G);
  check(r.spawns.slice(0, 3).every((q) => q[1] < 300) && r.spawns.slice(3).every((q) => q[1] > 700), "frente a frente: um time em cima, o outro embaixo");
}

// pontos das linhas
{
  const L: Pt[] = [[0, 0], [100, 0], [100, 100]];
  const sm = smoothLine(L);
  check(sm.length === 4 && sm[0].join() === "0,0" && sm[sm.length - 1].join() === "100,100", "suavizar mantém as pontas");
  check(simplifyLine([[0, 0], [50, 1], [100, 0], [100, 100]], 3).join("|") === "0,0|100,0|100,100", "simplificar tira o ponto que não muda nada");
  const [ins, k] = insertVertex(L, [100, 60]);
  check(ins.length === 4 && k === 2 && ins[2].join() === "100,60", "ponto novo entra no trecho certo");
  check(nearestVertex(L, [97, 3], 10) === 1 && nearestVertex(L, [50, 50], 10) === -1, "acha o ponto perto do clique");
}

// camada de construção e Raio-X
{
  const N = 128, w = N + 1;
  const flat = new Float32Array(w * w).fill(50);
  const sh = buildShares(N, G, flat, 0, false, 6);
  check(sh[0] > 0.99, `chão liso é todo plano (${sh.map((v) => v.toFixed(2)).join(" ")})`);
  const wall = flat.slice();
  for (let j = 0; j < w; j++) for (let i = 0; i < w; i++) wall[j * w + i] = i < 64 ? 20 : i < 70 ? 20 + (i - 64) * 30 : 200;
  const sw = buildShares(N, G, wall, 25, true, 6);
  check(sw[4] > 0.45 && sw[3] > 0.02 && sw[0] > 0.4, `água, paredão e plano (${sw.map((v) => v.toFixed(2)).join(" ")})`);
  const st = mapStats(flat, N, G, [[200, 200], [824, 824]], [[210, 210], [500, 500]]);
  const ck = compareCompetitive(st, G, 4);
  check(st.flat > 0.99 && ck.find((c) => c.id === "flat")?.verdict === "high" && ck.find((c) => c.id === "steep")?.verdict === "low", "Raio-X: mapa liso demais e sem paredões");
  check(ck.find((c) => c.id === "fair")?.verdict === "ok" && !!ck.find((c) => c.id === "mass")?.tip, "Raio-X: bases justas, pouca massa com dica");
}

// pincel de textura por partes dá o mesmo que refazer o mapa inteiro
{
  const N = 128, w = N + 1, base = new Float32Array(w * w);
  for (let k = 0; k < base.length; k++) base[k] = (k % 7) * 0.5;
  const world = newPaint(64), user = newPaint(256);
  paintDab(world, G, 300, 300, 200, 2, 1);
  const before = paintT(base, N, G, combinePaint(world, user));
  const live = before.slice();
  const deck = new Uint8Array(w * w); deck[40 * w + 40] = 1;
  paintDab(user, G, 320, 330, 60, 3, 0.8);
  paintTRegion(live, base, N, G, world, user, Math.floor(260 / 8) - 1, Math.floor(270 / 8) - 1, Math.ceil(380 / 8) + 1, Math.ceil(390 / 8) + 1, null);
  const full = paintT(base, N, G, combinePaint(world, user));
  let diff = 0;
  for (let k = 0; k < full.length; k++) diff = Math.max(diff, Math.abs(full[k] - live[k]));
  check(diff < 1e-6, `pincel por partes = mapa inteiro (diferença ${diff})`);
  const t0 = performance.now();
  for (let r = 0; r < 50; r++) paintTRegion(live, base, N, G, world, user, 30, 30, 50, 50, deck);
  const t1 = performance.now();
  for (let r = 0; r < 50; r++) paintT(base, N, G, combinePaint(world, user));
  const t2 = performance.now();
  check(live[40 * w + 40] === 5 && (t1 - t0) * 5 < t2 - t1, `por partes é bem mais rápido (${((t1 - t0) / 50).toFixed(3)} ms × ${((t2 - t1) / 50).toFixed(3)} ms por pincelada)`);
}

// prévia dos marcadores da IA (a mesma conta do toolkit)
{
  const sp: Pt[] = [[200, 200], [824, 824]], ms: Pt[] = [[500, 500], [515, 505], [505, 520], [700, 300]];
  const ai = aiMarkers(() => 50, () => true, G, sp, ms);
  const n = (k: string) => ai.filter((m) => m.kind === k).length;
  check(n("Land Path Node") === 169 && n("Air Path Node") === 64, `caminhos por terra e ar (${n("Land Path Node")}, ${n("Air Path Node")})`);
  check(n("Expansion Area") === 2 && n("Large Expansion Area") === 1 && n("Rally Point") === 2 && n("Protected Experimental Construction") === 2, "expansões, encontro e experimentais");
  check(n("Combat Zone") === 1 && n("Defensive Point") === 6, `combate e defesa (${n("Combat Zone")}, ${n("Defensive Point")})`);
  const wet = aiMarkers(() => 50, (x) => x > 512, G, sp, ms);
  check(wet.filter((m) => m.kind === "Land Path Node").every((m) => m.x > 512), "caminho por terra não cai na água");
}

// massa disputada: no meio entre as bases sim, colada numa base não
{
  const N = 128, w = N + 1, H = new Float32Array(w * w).fill(50);
  const g = { size: N, grid: G };
  const c = contestedMass(g, H, 0, false, [[200, 512], [824, 512]], [[512, 512], [250, 512], [520, 300]], (i) => i);
  check(c.join() === "0,2", `massa disputada (${c.join()})`);
  check(BUILTIN_PIECES.every((p) => p.clip.items.length >= 2), "peças prontas");
  const [d2, ids] = pasteClip(base(), BUILTIN_PIECES[0].clip, [600, 600], G, LIM, nid);
  check(ids.length === 4 && d2.edits.mass.length === 5 && d2.features.some((f) => f.kind === "pad" && f.pts[0][0] === 600), "peça de expansão colada");
}

console.log(fails ? `\n${fails} FALHA(S)` : "\ntudo ok");
process.exit(fails ? 1 : 0);
