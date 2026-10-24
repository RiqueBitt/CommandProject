// Geometria das peças do editor 3D, "assar" o modelo para o jogo (malha única + atlas de
// textura + ossos) e exportar OBJ/GLB.
import * as THREE from "three";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import type { BakedModel } from "../../lib/types";
import type { ModelDoc, ModelGroup, ModelPart, Vec3 } from "./docs";

const DEG = Math.PI / 180;

/** Rampa: caixa com o topo inclinado (frente baixa, trás alta). */
function wedge(w: number, h: number, d: number): THREE.BufferGeometry {
  const x = w / 2, z = d / 2;
  // vértices por face (normais retas), UV 0..1 por face
  const faces: [number[][], number[]][] = [
    [[[-x, 0, z], [x, 0, z], [x, 0, -z], [-x, 0, -z]], [0, -1, 0]], // base
    [[[-x, 0, -z], [x, 0, -z], [x, h, -z], [-x, h, -z]], [0, 0, -1]], // trás
    [[[-x, 0, z], [-x, h, -z], [x, h, -z], [x, 0, z]], [0, d, h]], // rampa
  ];
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
  for (const [vs, n] of faces) {
    const b = pos.length / 3;
    const nn = new THREE.Vector3(...(n as [number, number, number])).normalize();
    vs.forEach((v, i) => { pos.push(...v); nor.push(nn.x, nn.y, nn.z); uv.push([0, 1, 1, 0][i], [0, 0, 1, 1][i]); });
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  // laterais (triângulos)
  for (const [sx, n] of [[-x, -1], [x, 1]] as const) {
    const b = pos.length / 3;
    const tri = [[sx, 0, z], [sx, 0, -z], [sx, h, -z]];
    tri.forEach((v, i) => { pos.push(...v); nor.push(n, 0, 0); uv.push([0, 1, 1][i], [0, 0, 1][i]); });
    if (n < 0) idx.push(b, b + 2, b + 1); else idx.push(b, b + 1, b + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** Geometria local da peça (antes de posição/rotação/escala). */
export function partGeometry(p: ModelPart): THREE.BufferGeometry {
  const q = p.params;
  const seg = Math.max(3, Math.min(64, Math.round(q.seg ?? 24)));
  let g: THREE.BufferGeometry;
  switch (p.type) {
    case "box": g = new THREE.BoxGeometry(q.w ?? 2, q.h ?? 2, q.d ?? 2); break;
    case "cylinder": g = new THREE.CylinderGeometry(q.rt ?? 1, q.rb ?? 1, q.h ?? 2, seg); break;
    case "sphere": g = new THREE.SphereGeometry(q.r ?? 1, seg, Math.max(2, Math.round(seg * 0.6))); break;
    case "cone": g = new THREE.ConeGeometry(q.r ?? 1, q.h ?? 2, seg); break;
    case "torus": g = new THREE.TorusGeometry(q.r ?? 1, q.tube ?? 0.3, Math.max(3, Math.round(seg / 2)), seg); break;
    case "plane": g = new THREE.PlaneGeometry(q.w ?? 4, q.d ?? 4).rotateX(-Math.PI / 2); break;
    case "capsule": g = new THREE.CapsuleGeometry(q.r ?? 0.6, q.h ?? 1.6, Math.max(2, Math.round(seg / 4)), seg); break;
    case "wedge": g = wedge(q.w ?? 2, q.h ?? 2, q.d ?? 2).translate(0, -(q.h ?? 2) / 2, 0); break;
    case "mesh": {
      g = new THREE.BufferGeometry();
      const m = p.mesh;
      if (m && m.positions.length) {
        g.setAttribute("position", new THREE.Float32BufferAttribute(m.positions, 3));
        if (m.uvs && m.uvs.length === (m.positions.length / 3) * 2) g.setAttribute("uv", new THREE.Float32BufferAttribute(m.uvs, 2));
        else boxUv(g);
        g.setIndex(m.indices);
        g.computeVertexNormals();
      }
      break;
    }
  }
  return g;
}

/** UV por projeção de caixa (para malhas sem UV). */
function boxUv(g: THREE.BufferGeometry) {
  g.computeBoundingBox();
  const bb = g.boundingBox!;
  const size = bb.getSize(new THREE.Vector3());
  const pos = g.getAttribute("position");
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = size.x ? (pos.getX(i) - bb.min.x) / size.x : 0;
    uv[i * 2 + 1] = size.y ? (pos.getY(i) - bb.min.y) / size.y : 0;
  }
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
}

export function partMatrix(p: ModelPart): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...p.pos),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(p.rot[0] * DEG, p.rot[1] * DEG, p.rot[2] * DEG, "XYZ")),
    new THREE.Vector3(...p.scale),
  );
}

/** Converte uma peça em malha editável (para mexer nos vértices), mantendo posição/rotação/escala. */
export function toEditableMesh(p: ModelPart): ModelPart {
  if (p.type === "mesh") return p;
  const g = mergeVertices(partGeometry(p).deleteAttribute("normal"), 1e-5);
  const pos = Array.from(g.getAttribute("position").array as Float32Array);
  const uvA = g.getAttribute("uv");
  return {
    ...p, type: "mesh", params: {},
    mesh: { positions: pos.map((v) => Math.round(v * 10000) / 10000), indices: Array.from(g.index!.array as ArrayLike<number>), uvs: uvA ? Array.from(uvA.array as Float32Array) : undefined },
  };
}

export function groupPivot(doc: ModelDoc, g: ModelGroup): Vec3 {
  if (g.pivot) return g.pivot;
  const parts = doc.parts.filter((p) => p.group === g.id);
  if (!parts.length) return [0, 0, 0];
  const c = parts.reduce((a, p) => [a[0] + p.pos[0], a[1] + p.pos[1], a[2] + p.pos[2]], [0, 0, 0]);
  return [c[0] / parts.length, c[1] / parts.length, c[2] / parts.length].map((v) => Math.round(v * 100) / 100) as Vec3;
}

/** Ossos na ordem pai-antes-do-filho: raiz + um por grupo. */
export function boneList(doc: ModelDoc): { name: string; parent: number; world: Vec3; group: string | null }[] {
  const out: { name: string; parent: number; world: Vec3; group: string | null }[] = [{ name: "Root", parent: -1, world: [0, 0, 0], group: null }];
  const index = new Map<string, number>();
  const add = (g: ModelGroup, depth = 0) => {
    if (index.has(g.id) || depth > 32) return;
    if (g.parent) {
      const parent = doc.groups.find((x) => x.id === g.parent);
      if (parent) add(parent, depth + 1);
    }
    const parentIdx = g.parent && index.has(g.parent) ? index.get(g.parent)! : 0;
    index.set(g.id, out.length);
    out.push({ name: boneName(g.name), parent: parentIdx, world: groupPivot(doc, g), group: g.id });
  };
  doc.groups.forEach((g) => add(g));
  return out;
}

/** nome de osso aceito pelo jogo: letras, números e _ */
export const boneName = (s: string) => s.normalize("NFD").replace(/[^A-Za-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "Grupo";

// ------------------------------------------------------------------ texturas

export type TexResolver = (ref: { source: "asset" | "game"; ref: string }) => Promise<string | null>;

const imgCache = new Map<string, Promise<HTMLImageElement | null>>();
export function loadImage(url: string): Promise<HTMLImageElement | null> {
  if (!imgCache.has(url)) {
    imgCache.set(url, new Promise((res) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => res(null);
      im.src = url;
    }));
  }
  return imgCache.get(url)!;
}

// ------------------------------------------------------------------ assar

export interface BakeStats { vertices: number; triangles: number; parts: number; atlas: number; bones: number; warnings: string[] }

/** Junta todas as peças visíveis numa malha só, com um atlas de textura e um osso por grupo. */
export async function bake(doc: ModelDoc, resolve: TexResolver, scale = 1): Promise<{ baked: BakedModel; stats: BakeStats }> {
  const parts = doc.parts.filter((p) => !p.hidden && !doc.groups.find((g) => g.id === p.group)?.hidden);
  const warnings: string[] = [];
  if (!parts.length) throw new Error("O modelo está vazio: adicione pelo menos uma peça.");
  const n = Math.ceil(Math.sqrt(parts.length));
  const atlas = n <= 2 ? 512 : n <= 4 ? 1024 : 2048;
  const tile = atlas / n;
  const inset = Math.max(2, Math.round(tile * 0.02));
  const mk = () => { const c = document.createElement("canvas"); c.width = c.height = atlas; return c; };
  const [albedoC, teamC, glowC] = [mk(), mk(), mk()];
  const [ga, gt, gg] = [albedoC.getContext("2d")!, teamC.getContext("2d")!, glowC.getContext("2d")!];
  ga.fillStyle = "#808080"; ga.fillRect(0, 0, atlas, atlas);
  gt.clearRect(0, 0, atlas, atlas);
  gg.fillStyle = "#000"; gg.fillRect(0, 0, atlas, atlas);

  const bones = boneList(doc);
  const boneOf = (p: ModelPart) => Math.max(0, bones.findIndex((b) => b.group === p.group));
  const pos: number[] = [], nor: number[] = [], uvs: number[] = [], idx: number[] = [], bi: number[] = [];

  for (let k = 0; k < parts.length; k++) {
    const p = parts[k];
    const tx = (k % n) * tile, ty = Math.floor(k / n) * tile;
    // tile da cor (com a textura repetida uvScale vezes)
    ga.fillStyle = p.material.color;
    ga.fillRect(tx, ty, tile, tile);
    if (p.material.texture) {
      const url = await resolve(p.material.texture);
      const im = url ? await loadImage(url) : null;
      if (im) {
        const rep = Math.max(1, Math.min(16, Math.round(p.material.uvScale || 1)));
        const s = tile / rep;
        ga.save();
        ga.beginPath(); ga.rect(tx, ty, tile, tile); ga.clip();
        for (let a = 0; a < rep; a++) for (let b = 0; b < rep; b++) ga.drawImage(im, tx + a * s, ty + b * s, s, s);
        // a cor escolhida tinge a textura (branco = sem tingir)
        if (p.material.color.toLowerCase() !== "#ffffff") {
          ga.globalCompositeOperation = "multiply";
          ga.fillStyle = p.material.color;
          ga.fillRect(tx, ty, tile, tile);
          ga.globalCompositeOperation = "source-over";
        }
        ga.restore();
      } else warnings.push(`textura da peça "${p.name}" não carregou; usei só a cor`);
    }
    if (p.material.team) { gt.fillStyle = "#fff"; gt.fillRect(tx, ty, tile, tile); }
    if (p.material.emissive) { gg.fillStyle = p.material.emissive; gg.fillRect(tx, ty, tile, tile); }

    const g = partGeometry(p);
    if (!g.getAttribute("normal")) g.computeVertexNormals();
    const m = new THREE.Matrix4().makeScale(scale, scale, scale).multiply(partMatrix(p));
    g.applyMatrix4(m);
    const P = g.getAttribute("position"), N = g.getAttribute("normal"), U = g.getAttribute("uv");
    const base = pos.length / 3;
    const b = boneOf(p);
    for (let i = 0; i < P.count; i++) {
      pos.push(P.getX(i), P.getY(i), P.getZ(i));
      nor.push(N.getX(i), N.getY(i), N.getZ(i));
      const u = U ? Math.min(1, Math.max(0, U.getX(i))) : 0.5, v = U ? Math.min(1, Math.max(0, U.getY(i))) : 0.5;
      // atlas: v cresce para baixo (as texturas do jogo são lidas sem inverter)
      uvs.push((tx + inset + u * (tile - inset * 2)) / atlas, (ty + inset + (1 - v) * (tile - inset * 2)) / atlas);
      bi.push(b);
    }
    const I = g.index;
    if (I) for (let i = 0; i < I.count; i++) idx.push(base + I.getX(i));
    else for (let i = 0; i < P.count; i++) idx.push(base + i);
    g.dispose();
  }
  const vertices = pos.length / 3;
  if (vertices > 65536) warnings.push(`O modelo tem ${vertices} vértices; o jogo aceita até 65536. Use menos segmentos nas peças redondas.`);
  const b64 = (c: HTMLCanvasElement) => c.toDataURL("image/png");
  const boneOut = bones.map((b) => {
    const parent = b.parent >= 0 ? bones[b.parent].world : [0, 0, 0];
    return { name: b.name, parent: b.parent, pos: [(b.world[0] - parent[0]) * scale, (b.world[1] - parent[1]) * scale, (b.world[2] - parent[2]) * scale] as Vec3, rot: [1, 0, 0, 0] as [number, number, number, number] };
  });
  const names = new Set<string>();
  for (const b of boneOut) { if (names.has(b.name.toLowerCase())) warnings.push(`Dois grupos com o nome "${b.name}": renomeie (cada osso precisa de um nome único).`); names.add(b.name.toLowerCase()); }
  return {
    baked: {
      positions: pos, normals: nor, uvs, indices: idx, boneIndex: bi, bones: boneOut,
      albedoPng: b64(albedoC), teamPng: parts.some((p) => p.material.team) ? b64(teamC) : null, glowPng: parts.some((p) => p.material.emissive) ? b64(glowC) : null,
    },
    stats: { vertices, triangles: idx.length / 3, parts: parts.length, atlas, bones: boneOut.length, warnings },
  };
}

/** Malha three.js de um modelo assado (para ver o resultado, exportar OBJ/GLB). */
export function bakedObject(b: BakedModel): THREE.Mesh {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(b.positions, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(b.normals, 3));
  // exportar: v para cima (convenção OBJ/glTF)
  g.setAttribute("uv", new THREE.Float32BufferAttribute(b.uvs.map((v, i) => (i % 2 ? 1 - v : v)), 2));
  g.setIndex(b.indices);
  const tex = new THREE.TextureLoader().load(b.albedoPng);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 }));
}

/** Importa OBJ/GLB como uma peça "malha" (geometria juntada, centralizada e com tamanho razoável). */
export async function importMesh(file: File): Promise<{ positions: number[]; indices: number[]; uvs?: number[]; triangles: number }> {
  const name = file.name.toLowerCase();
  const root = new THREE.Group();
  if (name.endsWith(".obj")) {
    const { OBJLoader } = await import("three/addons/loaders/OBJLoader.js");
    root.add(new OBJLoader().parse(await file.text()));
  } else if (name.endsWith(".glb") || name.endsWith(".gltf")) {
    const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
    const buf = await file.arrayBuffer();
    const gltf = await new GLTFLoader().parseAsync(name.endsWith(".gltf") ? new TextDecoder().decode(buf) : buf, "");
    root.add(gltf.scene);
  } else throw new Error("Formato não suportado: use .obj, .glb ou .gltf");
  root.updateMatrixWorld(true);
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  let hasUv = true;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.geometry) return;
    const g = m.geometry.clone().applyMatrix4(m.matrixWorld);
    const P = g.getAttribute("position"), U = g.getAttribute("uv");
    if (!U) hasUv = false;
    const base = pos.length / 3;
    for (let i = 0; i < P.count; i++) { pos.push(P.getX(i), P.getY(i), P.getZ(i)); uv.push(U ? U.getX(i) : 0, U ? U.getY(i) : 0); }
    if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(base + g.index.getX(i));
    else for (let i = 0; i < P.count; i++) idx.push(base + i);
    g.dispose();
  });
  if (!pos.length) throw new Error("O arquivo não tem malhas.");
  // centraliza no chão e limita o tamanho a ~6 unidades
  const bb = new THREE.Box3().setFromArray(pos);
  const size = bb.getSize(new THREE.Vector3());
  const k = Math.max(size.x, size.y, size.z) > 12 ? 6 / Math.max(size.x, size.y, size.z) : 1;
  const c = bb.getCenter(new THREE.Vector3());
  for (let i = 0; i < pos.length; i += 3) {
    pos[i] = Math.round((pos[i] - c.x) * k * 1e4) / 1e4;
    pos[i + 1] = Math.round((pos[i + 1] - bb.min.y) * k * 1e4) / 1e4;
    pos[i + 2] = Math.round((pos[i + 2] - c.z) * k * 1e4) / 1e4;
  }
  return { positions: pos, indices: idx, uvs: hasUv ? uv : undefined, triangles: idx.length / 3 };
}

/** OBJ ou GLB das peças (com cores; o GLB leva o atlas assado). */
export async function exportFile(b: BakedModel, format: "obj" | "glb"): Promise<Blob> {
  const mesh = bakedObject(b);
  if (format === "obj") {
    const { OBJExporter } = await import("three/addons/exporters/OBJExporter.js");
    return new Blob([new OBJExporter().parse(mesh)], { type: "text/plain" });
  }
  const { GLTFExporter } = await import("three/addons/exporters/GLTFExporter.js");
  // espera a textura do atlas carregar
  await new Promise((r) => setTimeout(r, 50));
  const out = await new GLTFExporter().parseAsync(mesh, { binary: true });
  return new Blob([out as ArrayBuffer], { type: "model/gltf-binary" });
}
