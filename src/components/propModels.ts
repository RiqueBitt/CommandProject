// Modelos das decorações do jogo para o editor de mapas: lidos uma vez (nível de detalhe 1, leve
// para milhares de cópias), com a textura do próprio jogo, e compartilhados entre todas as cópias.
import * as THREE from "three";
import { api } from "../lib/api";

export interface PropModel {
  geo: THREE.BufferGeometry;
  mat: THREE.MeshStandardMaterial;
}

const cache = new Map<string, Promise<PropModel | null>>();
const ready = new Map<string, PropModel | null>();
const loader = new THREE.TextureLoader();

// no máximo 3 pedidos ao mesmo tempo: o resto espera na fila (o editor pede dezenas de uma vez)
let running = 0;
const waiting: (() => void)[] = [];
async function limited<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= 3) await new Promise<void>((r) => waiting.push(r));
  running++;
  try {
    return await fn();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

function build(mesh: { positions: number[]; normals: number[]; uvs: number[]; indices: number[] }, texture?: string | null): PropModel | null {
  if (!mesh.positions.length || !mesh.indices.length) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(mesh.positions, 3));
  if (mesh.uvs.length) geo.setAttribute("uv", new THREE.Float32BufferAttribute(mesh.uvs, 2));
  geo.setIndex(mesh.indices);
  if (mesh.normals.some((n) => n !== 0)) geo.setAttribute("normal", new THREE.Float32BufferAttribute(mesh.normals, 3));
  else geo.computeVertexNormals();
  geo.computeBoundingSphere();
  const mat = new THREE.MeshStandardMaterial({ color: 0x9aa59a, roughness: 0.9, metalness: 0, side: THREE.DoubleSide });
  if (texture) {
    loader.load(texture, (t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      t.flipY = false;
      t.anisotropy = 4;
      mat.map = t;
      mat.color.set(0xffffff);
      // folhas e grades usam o alfa da textura como recorte
      mat.alphaTest = 0.45;
      mat.needsUpdate = true;
    });
  }
  return { geo, mat };
}

/** Modelo pronto (ou `undefined` se ainda não carregou; `null` = sem modelo). */
export const propModelNow = (bp: string, lod = 1) => ready.get(`${bp.toLowerCase()}#${lod}`);

/** Carrega o modelo da decoração (uma vez por blueprint e nível de detalhe). */
export function propModel(bp: string, lod = 1): Promise<PropModel | null> {
  const key = `${bp.toLowerCase()}#${lod}`;
  let p = cache.get(key);
  if (!p) {
    p = limited(() => api.propPreview(bp, lod))
      .then((r) => build(r.mesh, r.texture))
      .catch(() => null)
      .then((m) => {
        ready.set(key, m);
        return m;
      });
    cache.set(key, p);
  }
  return p;
}
