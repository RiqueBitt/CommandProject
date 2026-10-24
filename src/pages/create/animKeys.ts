// Animação por quadros-chave calculada no navegador, com a mesma regra do gerador do launcher
// (anim.rs: posição de repouso + deslocamento; rotação de repouso × giro XYZ em graus, com slerp),
// para a prévia mostrar exatamente o que vai para o jogo.
import * as THREE from "three";
import type { AnimKey, ScaAnimation } from "../../lib/types";
import type { ViewModel } from "./UnitViewport";

const q4 = (r: [number, number, number, number]) => new THREE.Quaternion(r[1], r[2], r[3], r[0]);
const euler = (deg: [number, number, number]) => new THREE.Quaternion().setFromEuler(new THREE.Euler(...deg.map((d) => (d * Math.PI) / 180) as [number, number, number], "XYZ"));

export function animFromKeys(view: ViewModel, keys: AnimKey[], duration: number, fps = 30): ScaAnimation {
  const dur = Math.max(0.05, duration);
  const n = Math.max(2, Math.round(dur * fps));
  const byBone = new Map<string, AnimKey[]>();
  for (const k of keys) (byBone.get(k.bone) ?? byBone.set(k.bone, []).get(k.bone)!).push(k);
  for (const l of byBone.values()) l.sort((a, b) => a.time - b.time);
  const frames: ScaAnimation["frames"] = [];
  for (let f = 0; f < n; f++) {
    const t = (dur * f) / (n - 1);
    const positions: [number, number, number][] = [], rotations: [number, number, number, number][] = [];
    for (const b of view.bones) {
      const ks = byBone.get(b.name);
      if (!ks?.length) { positions.push(b.pos); rotations.push(b.rot); continue; }
      let i = ks.findIndex((k) => k.time >= t);
      if (i < 0) i = ks.length;
      const a = i === 0 ? ks[0] : ks[Math.min(i, ks.length) - 1], c = i >= ks.length ? ks[ks.length - 1] : ks[i];
      const u = c.time > a.time ? (t - a.time) / (c.time - a.time) : 0;
      positions.push([0, 1, 2].map((k) => b.pos[k] + a.pos[k] + (c.pos[k] - a.pos[k]) * u) as [number, number, number]);
      const q = q4(b.rot).multiply(euler(a.rot).slerp(euler(c.rot), u));
      rotations.push([q.w, q.x, q.y, q.z]);
    }
    frames.push({ time: t, flags: 0, positions, rotations });
  }
  return {
    version: 5, duration: dur, bones: view.bones.map((b) => b.name), parents: view.bones.map((b) => b.parent),
    deltaPosition: [0, 0, 0], deltaRotation: [1, 0, 0, 0], frames,
  };
}

/** valor de um osso num instante (para criar um quadro-chave no meio de dois) */
export function sampleKey(keys: AnimKey[], bone: string, t: number): Pick<AnimKey, "pos" | "rot"> {
  const ks = keys.filter((k) => k.bone === bone).sort((a, b) => a.time - b.time);
  if (!ks.length) return { pos: [0, 0, 0], rot: [0, 0, 0] };
  let i = ks.findIndex((k) => k.time >= t);
  if (i < 0) return { pos: [...ks[ks.length - 1].pos], rot: [...ks[ks.length - 1].rot] };
  if (i === 0) return { pos: [...ks[0].pos], rot: [...ks[0].rot] };
  const a = ks[i - 1], c = ks[i], u = c.time > a.time ? (t - a.time) / (c.time - a.time) : 0;
  const lerp3 = (x: [number, number, number], y: [number, number, number]) => [0, 1, 2].map((k) => Math.round((x[k] + (y[k] - x[k]) * u) * 100) / 100) as [number, number, number];
  return { pos: lerp3(a.pos, c.pos), rot: lerp3(a.rot, c.rot) };
}

/** Modelos de animação prontos para começar (sobre um osso escolhido). */
export const ANIM_TEMPLATES: { id: string; label: string; field: string; duration: number; make: (bone: string, all: string[]) => AnimKey[] }[] = [
  { id: "turret-scan", label: "Torre vigiando", field: "Display.AnimationIdle", duration: 4, make: (b) => [
    { bone: b, time: 0, pos: [0, 0, 0], rot: [0, 0, 0] }, { bone: b, time: 1, pos: [0, 0, 0], rot: [0, 35, 0] },
    { bone: b, time: 3, pos: [0, 0, 0], rot: [0, -35, 0] }, { bone: b, time: 4, pos: [0, 0, 0], rot: [0, 0, 0] }] },
  { id: "recoil", label: "Recuo do tiro", field: "Display.AnimationFire", duration: 0.6, make: (b) => [
    { bone: b, time: 0, pos: [0, 0, 0], rot: [0, 0, 0] }, { bone: b, time: 0.08, pos: [0, 0, -0.15], rot: [-6, 0, 0] },
    { bone: b, time: 0.6, pos: [0, 0, 0], rot: [0, 0, 0] }] },
  { id: "bob", label: "Balanço ao andar", field: "Display.AnimationWalk", duration: 1, make: (b) => [
    { bone: b, time: 0, pos: [0, 0, 0], rot: [0, 0, 0] }, { bone: b, time: 0.25, pos: [0, 0.04, 0], rot: [2, 0, 1.5] },
    { bone: b, time: 0.5, pos: [0, 0, 0], rot: [0, 0, 0] }, { bone: b, time: 0.75, pos: [0, 0.04, 0], rot: [2, 0, -1.5] }, { bone: b, time: 1, pos: [0, 0, 0], rot: [0, 0, 0] }] },
  { id: "deploy", label: "Abrir / transformar", field: "Display.AnimationActivate", duration: 2, make: (b) => [
    { bone: b, time: 0, pos: [0, 0, 0], rot: [0, 0, 0] }, { bone: b, time: 1.2, pos: [0, 0.25, 0], rot: [-30, 0, 0] }, { bone: b, time: 2, pos: [0, 0.3, 0], rot: [-35, 0, 0] }] },
  { id: "death", label: "Tombar (morte)", field: "Display.AnimationDeath", duration: 1.5, make: (b) => [
    { bone: b, time: 0, pos: [0, 0, 0], rot: [0, 0, 0] }, { bone: b, time: 0.4, pos: [0, 0.05, 0], rot: [0, 0, 12] }, { bone: b, time: 1.5, pos: [0, -0.1, 0], rot: [8, 0, 75] }] },
  { id: "build", label: "Construir (braço)", field: "Display.AnimationBuild", duration: 2, make: (b) => [
    { bone: b, time: 0, pos: [0, 0, 0], rot: [0, 0, 0] }, { bone: b, time: 0.5, pos: [0, 0, 0], rot: [-25, 15, 0] },
    { bone: b, time: 1, pos: [0, 0, 0], rot: [-10, -15, 0] }, { bone: b, time: 1.5, pos: [0, 0, 0], rot: [-25, 15, 0] }, { bone: b, time: 2, pos: [0, 0, 0], rot: [0, 0, 0] }] },
];
