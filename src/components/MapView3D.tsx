import { useEffect, useRef } from "react";
import * as THREE from "three";
import { naturalColor } from "../pages/create/worldgen";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { heightAt, type DecorKind, type Pt, type Rect } from "../pages/studio/mapEdit";
import { propModel, propModelNow } from "./propModels";

export interface Marker { p: Pt; color: string; label: string }
/** decoração mostrada no editor: x, z, yaw (graus), escala, tipo; `added` = colocada por você */
export interface DecorPoint { x: number; z: number; yaw: number; scale: number; kind: DecorKind; bp?: string; added?: boolean }
export type Brush = { shape: "circle"; radius: number; color: string } | { shape: "point"; color: string } | null;

interface Props {
  size: number;
  grid: number;
  heights: Float32Array;
  waterLevel: number;
  texture: string | null;
  exaggeration: number;
  spawns: Marker[];
  mass: Pt[];
  autoMass?: Pt[];
  bridges: Rect[];
  seed: Pt | null;
  brush: Brush;
  drag: { a: Pt; b: Pt } | null;
  /** árvores, pedras, prédios… (instanciados, aguenta dezenas de milhares) */
  decor?: DecorPoint[];
  /** áreas onde as decorações do terreno serão retiradas */
  cuts?: [number, number, number][];
  /** objetos selecionados: círculos amarelos [x, z, raio] */
  highlights?: [number, number, number][];
  /** recebe uma função que tira uma foto da vista (miniatura do projeto) */
  snapshotRef?: { current: (() => string | null) | null };
  /** câmera livre: o botão esquerdo gira em vez de editar */
  orbit: boolean;
  /** sem textura: cores naturais do relevo (água, areia, grama, rocha, neve) neste bioma */
  palette?: "temperate" | "desert" | "snow" | "volcanic" | null;
  /** linhas no chão (rios, cordilheiras, passagens): pontos e cor */
  lines?: { pts: Pt[]; color: string }[];
  onPointer: (type: "down" | "move" | "up", p: Pt | null) => void;
}

const SKY = 0x0b1118;

/** Editor 3D: relevo do terreno com a textura do jogo, água, marcadores e pincel. */
export default function MapView3D(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const live = useRef(props);
  live.current = props;
  const api = useRef<{
    setHeights: () => void;
    setTexture: (url: string | null) => void;
    setMarkers: () => void;
    setDecor: () => void;
    setHighlights: () => void;
    setOrbit: (on: boolean) => void;
    setExaggeration: () => void;
    redrawBrush: () => void;
  } | null>(null);

  // cena: criada uma vez por terreno
  useEffect(() => {
    const el = host.current!;
    const { size, grid } = live.current;
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio));
    let dirty = true;
    const invalidate = () => { dirty = true; };
    renderer.setSize(el.clientWidth, el.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(SKY);
    scene.fog = new THREE.Fog(SKY, grid * 1.6, grid * 3.4);
    const camera = new THREE.PerspectiveCamera(42, el.clientWidth / Math.max(1, el.clientHeight), 4, grid * 6);

    // relevo
    const w = size + 1, step = grid / size;
    const pos = new Float32Array(w * w * 3);
    const uv = new Float32Array(w * w * 2);
    const col = new Float32Array(w * w * 3);
    for (let j = 0; j < w; j++) for (let i = 0; i < w; i++) {
      const k = j * w + i;
      pos[k * 3] = i * step;
      pos[k * 3 + 2] = j * step;
      uv[k * 2] = i / size;
      uv[k * 2 + 1] = j / size; // a linha 0 do minimapa é z = 0 (verificado contra o heightfield)
    }
    const idx = new Uint32Array(size * size * 6);
    let n = 0;
    for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
      const a = j * w + i, b = a + 1, c = a + w, d = c + 1;
      idx.set([a, c, b, b, c, d], n);
      n += 6;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0, vertexColors: true });
    const ground = new THREE.Mesh(geo, mat);
    scene.add(ground);

    // saia nas bordas para o relevo não parecer uma folha solta
    const skirtMat = new THREE.MeshStandardMaterial({ color: 0x1a222b, roughness: 1, side: THREE.DoubleSide });
    const skirtGeo = new THREE.BufferGeometry();
    const skirtPos = new Float32Array(4 * w * 2 * 3);
    skirtGeo.setAttribute("position", new THREE.BufferAttribute(skirtPos, 3));
    const sIdx: number[] = [];
    for (let e = 0; e < 4; e++) for (let i = 0; i < size; i++) {
      const a = (e * w + i) * 2, b = a + 2;
      sIdx.push(a, a + 1, b, b, a + 1, b + 1);
    }
    skirtGeo.setIndex(sIdx);
    const skirt = new THREE.Mesh(skirtGeo, skirtMat);
    scene.add(skirt);

    // água
    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(grid, grid),
      new THREE.MeshStandardMaterial({ color: 0x2b6c9e, transparent: true, opacity: 0.62, roughness: 0.15, metalness: 0.1, depthWrite: false }),
    );
    water.rotation.x = -Math.PI / 2;
    water.position.set(grid / 2, 0, grid / 2);
    water.renderOrder = 2;
    scene.add(water);

    // grade sutil por baixo
    const floor = new THREE.GridHelper(grid * 3, 30, 0x1f3a2c, 0x16212b);
    floor.position.set(grid / 2, -2, grid / 2);
    scene.add(floor);

    // luzes
    scene.add(new THREE.HemisphereLight(0xdfeaff, 0x1b2016, 1.25));
    const sun = new THREE.DirectionalLight(0xfff1dc, 2.3);
    sun.position.set(grid * 0.15, grid * 0.9, grid * -0.35);
    sun.target.position.set(grid / 2, 0, grid / 2);
    scene.add(sun, sun.target);

    // marcadores e pincel
    const markers = new THREE.Group();
    scene.add(markers);
    const brushLine = new THREE.LineLoop(
      new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(new Float32Array(96 * 3), 3)),
      new THREE.LineBasicMaterial({ color: 0xa3e635, depthTest: false, transparent: true }),
    );
    brushLine.renderOrder = 5;
    brushLine.visible = false;
    scene.add(brushLine);
    const dragBox = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xf2b33d, transparent: true, opacity: 0.3, depthWrite: false }));
    dragBox.visible = false;
    scene.add(dragBox);

    const exag = () => live.current.exaggeration;
    const hAt = (x: number, z: number) => heightAt({ size, grid }, live.current.heights, x, z) * exag();

    let texture: THREE.Texture | null = null;
    const loader = new THREE.TextureLoader();
    const setTexture = (url: string | null) => {
      texture?.dispose();
      texture = null;
      mat.map = null;
      mat.vertexColors = true;
      mat.needsUpdate = true;
      if (!url) return;
      loader.load(url, (t) => {
        if (live.current.texture !== url) { t.dispose(); return; }
        t.flipY = false;
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = renderer.capabilities.getMaxAnisotropy();
        texture = t;
        mat.map = t;
        mat.vertexColors = false;
        mat.needsUpdate = true;
        invalidate();
      });
    };

    const colorFor = (y: number, wl: number, lo: number, hi: number, out: THREE.Color) => {
      if (y < wl - 0.5) return out.setRGB(0.36, 0.42, 0.38);
      const t = Math.max(0, Math.min(1, (y - lo) / Math.max(1, hi - lo)));
      return out.setRGB(0.32 + t * 0.4, 0.45 + t * 0.25, 0.27 + t * 0.32);
    };

    const setHeights = () => {
      const { heights, waterLevel } = live.current;
      const e = exag();
      let lo = Infinity, hi = -Infinity;
      for (let k = 0; k < heights.length; k++) { lo = Math.min(lo, heights[k]); hi = Math.max(hi, heights[k]); }
      const c = new THREE.Color();
      const pal = live.current.palette;
      const st = grid / size;
      for (let k = 0; k < w * w; k++) {
        pos[k * 3 + 1] = heights[k] * e;
        if (pal) {
          const i = k % w, j = (k - i) / w;
          const dx = (heights[Math.min(k + 1, j * w + size)] - heights[Math.max(k - 1, j * w)]) / (2 * st);
          const dz = (heights[Math.min(k + w, w * w - 1)] - heights[Math.max(k - w, 0)]) / (2 * st);
          const [r, g, b] = naturalColor(heights[k], Math.hypot(dx, dz), waterLevel, waterLevel > 0.5, lo, hi, pal, 1);
          c.setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
        } else colorFor(heights[k], waterLevel, lo, hi, c);
        col.set([c.r, c.g, c.b], k * 3);
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.color.needsUpdate = true;
      geo.computeVertexNormals();
      geo.computeBoundingSphere();
      geo.computeBoundingBox();
      // saia: borda superior acompanha o relevo, a inferior desce até o chão
      const edge = (e2: number, i: number) => (e2 === 0 ? i : e2 === 1 ? size * w + i : e2 === 2 ? i * w : i * w + size);
      for (let e2 = 0; e2 < 4; e2++) for (let i = 0; i < w; i++) {
        const k = edge(e2, i), o = (e2 * w + i) * 6;
        skirtPos.set([pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2], pos[k * 3], -2, pos[k * 3 + 2]], o);
      }
      skirtGeo.attributes.position.needsUpdate = true;
      skirtGeo.computeVertexNormals();
      skirtGeo.computeBoundingSphere();
      water.position.y = waterLevel * e;
      water.visible = waterLevel > lo + 0.5;
      setMarkers();
      setDecor();
      setHighlights();
      redrawBrush();
    };

    const label = (text: string, color: string) => {
      const cv = document.createElement("canvas");
      cv.width = cv.height = 96;
      const g = cv.getContext("2d")!;
      g.fillStyle = color;
      g.beginPath();
      g.arc(48, 48, 40, 0, Math.PI * 2);
      g.fill();
      g.lineWidth = 8;
      g.strokeStyle = "#0d1b26";
      g.stroke();
      g.fillStyle = "#0d1b26";
      g.font = "700 46px 'Chakra Petch', sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(text, 48, 52);
      const t = new THREE.CanvasTexture(cv);
      t.colorSpace = THREE.SRGBColorSpace;
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false }));
      s.renderOrder = 6;
      return s;
    };

    const clearGroup = () => {
      for (const o of [...markers.children]) {
        markers.remove(o);
        o.traverse((c) => {
          if (c instanceof THREE.Mesh || c instanceof THREE.Sprite) {
            if (c instanceof THREE.Mesh) c.geometry.dispose();
            const m = c.material as THREE.Material & { map?: THREE.Texture | null };
            m.map?.dispose();
            m.dispose();
          }
        });
      }
    };

    const setMarkers = () => {
      clearGroup();
      const { spawns, mass, autoMass, bridges, seed } = live.current;
      const scale = grid / 1024;
      spawns.forEach((m) => {
        const y = hAt(m.p[0], m.p[1]);
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(3.5 * scale, 3.5 * scale, 80 * scale, 10), new THREE.MeshBasicMaterial({ color: m.color }));
        pole.position.set(m.p[0], y + 40 * scale, m.p[1]);
        const base = new THREE.Mesh(new THREE.RingGeometry(22 * scale, 30 * scale, 40), new THREE.MeshBasicMaterial({ color: m.color, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }));
        base.rotation.x = -Math.PI / 2;
        base.position.set(m.p[0], y + 1.2, m.p[1]);
        const s = label(m.label, m.color);
        s.scale.setScalar(52 * scale);
        s.position.set(m.p[0], y + 104 * scale, m.p[1]);
        markers.add(pole, base, s);
      });
      const gem = (p: Pt, color: number, r: number) => {
        const y = hAt(p[0], p[1]);
        const o = new THREE.Mesh(new THREE.OctahedronGeometry(r * scale), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.6, roughness: 0.3 }));
        o.position.set(p[0], y + r * 1.6 * scale, p[1]);
        o.scale.y = 1.5;
        markers.add(o);
      };
      mass.forEach((p) => gem(p, 0x7bd88f, 11));
      (autoMass ?? []).forEach((p) => gem(p, 0x3f8f5a, 4.5));
      bridges.forEach(([x0, x1, z0, z1]) => {
        const y = Math.max(hAt(x0, z0), hAt(x1, z1), hAt((x0 + x1) / 2, (z0 + z1) / 2), live.current.waterLevel * exag());
        const b = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 3, z1 - z0), new THREE.MeshBasicMaterial({ color: 0xf2b33d, transparent: true, opacity: 0.45, depthWrite: false }));
        b.position.set((x0 + x1) / 2, y + 1.5, (z0 + z1) / 2);
        markers.add(b);
      });
      if (seed) {
        const y = hAt(seed[0], seed[1]);
        const c = new THREE.Mesh(new THREE.TorusGeometry(10 * scale, 1.6 * scale, 8, 32), new THREE.MeshBasicMaterial({ color: 0xffffff }));
        c.rotation.x = -Math.PI / 2;
        c.position.set(seed[0], y + 3, seed[1]);
        markers.add(c);
      }
      for (const ln of live.current.lines ?? []) {
        const pts: THREE.Vector3[] = [];
        for (let k = 0; k < ln.pts.length - 1; k++) {
          const [ax, az] = ln.pts[k], [bx, bz] = ln.pts[k + 1];
          const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 6));
          for (let t = 0; t <= n; t++) {
            const x = ax + ((bx - ax) * t) / n, z = az + ((bz - az) * t) / n;
            pts.push(new THREE.Vector3(x, Math.max(hAt(x, z), live.current.waterLevel * exag()) + 2.5, z));
          }
        }
        if (pts.length < 2) continue;
        const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineDashedMaterial({ color: ln.color, dashSize: 10, gapSize: 6, depthTest: false, transparent: true }));
        l.computeLineDistances();
        l.renderOrder = 4;
        markers.add(l);
      }
    };

    // decorações: uma malha instanciada por tipo (cores sólidas, leve mesmo com 20 mil árvores)
    const decorGroup = new THREE.Group();
    scene.add(decorGroup);
    const KIND_GEO: Record<DecorKind, () => THREE.BufferGeometry> = {
      tree: () => new THREE.ConeGeometry(2.6, 10, 7).translate(0, 5, 0),
      rock: () => new THREE.DodecahedronGeometry(2.4, 0).scale(1, 0.6, 1).translate(0, 0.8, 0),
      building: () => new THREE.BoxGeometry(7, 6, 7).translate(0, 3, 0),
      wreck: () => new THREE.BoxGeometry(5, 1.6, 3).translate(0, 0.8, 0),
      other: () => new THREE.OctahedronGeometry(1.8).translate(0, 1.8, 0),
    };
    const KIND_COLOR: Record<DecorKind, number> = { tree: 0x3f7d3a, rock: 0x8a8378, building: 0xb39b78, wreck: 0x6b4a3a, other: 0x9aa7b4 };
    const cutRing = new THREE.Group();
    scene.add(cutRing);
    const hiGroup = new THREE.Group();
    hiGroup.renderOrder = 7;
    scene.add(hiGroup);
    const clearDecor = () => {
      for (const g of [decorGroup, cutRing]) for (const o of [...g.children]) {
        g.remove(o);
        if (o.userData.shared) { (o as THREE.InstancedMesh).dispose(); continue; } // modelo do jogo: reaproveitado
        const m = o as THREE.Mesh;
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
    };
    // quando um modelo termina de carregar, a cena é refeita (agrupando vários num quadro só)
    let decorQueued = 0;
    const queueDecor = () => {
      if (decorQueued) return;
      decorQueued = window.setTimeout(() => { decorQueued = 0; api.current?.setDecor(); }, 120);
    };
    const setDecor = () => {
      clearDecor();
      const { decor = [], cuts = [] } = live.current;
      // agrupa por modelo (blueprint); sem modelo, por tipo
      const by = new Map<string, DecorPoint[]>();
      for (const d of decor) {
        const key = d.bp ? `bp:${d.bp.toLowerCase()}` : `k:${d.kind}`;
        (by.get(key) ?? by.set(key, []).get(key)!).push(d);
      }
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
      for (const [key, list] of by) {
        const bp = key.startsWith("bp:") ? list[0].bp! : null;
        // muitas cópias do mesmo modelo: versão mais simples (nível 2), para o editor continuar leve
        const lod = list.length > 1500 ? 2 : 1;
        const model = bp ? propModelNow(bp, lod) : null;
        if (bp && model === undefined) void propModel(bp, lod).then(queueDecor);
        let mesh: THREE.InstancedMesh;
        if (model) {
          mesh = new THREE.InstancedMesh(model.geo, model.mat, list.length);
          mesh.userData.shared = true;
        } else {
          const kind = list[0].kind;
          mesh = new THREE.InstancedMesh(KIND_GEO[kind](), new THREE.MeshStandardMaterial({ color: KIND_COLOR[kind], roughness: 0.85, flatShading: true }), list.length);
        }
        const fresh = new THREE.Color(0xc8f08a), plain = new THREE.Color(0xffffff);
        list.forEach((d, i) => {
          q.setFromAxisAngle(up, (d.yaw * Math.PI) / 180);
          const s = Math.max(0.01, d.scale || 1);
          sc.set(s, s, s);
          v.set(d.x, hAt(d.x, d.z), d.z);
          mesh.setMatrixAt(i, m4.compose(v, q, sc));
          mesh.setColorAt(i, d.added ? fresh : plain); // as que você colocou ficam levemente verdes
        });
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.computeBoundingSphere();
        decorGroup.add(mesh);
      }
      for (const [x, z, r] of cuts) {
        const pts = new Float32Array(64 * 3);
        for (let i = 0; i < 64; i++) {
          const a = (i / 64) * Math.PI * 2, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
          pts.set([px, hAt(Math.max(0, Math.min(grid, px)), Math.max(0, Math.min(grid, pz))) + 1, pz], i * 3);
        }
        const l = new THREE.LineLoop(new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(pts, 3)), new THREE.LineBasicMaterial({ color: 0xe5534b, transparent: true, opacity: 0.8 }));
        cutRing.add(l);
      }
    };

    const setHighlights = () => {
      for (const o of [...hiGroup.children]) {
        hiGroup.remove(o);
        const m = o as THREE.Line;
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
      for (const [x, z, r] of live.current.highlights ?? []) {
        const pts = new Float32Array(48 * 3);
        for (let i = 0; i < 48; i++) {
          const a = (i / 48) * Math.PI * 2, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
          pts.set([px, hAt(Math.max(0, Math.min(grid, px)), Math.max(0, Math.min(grid, pz))) + 2, pz], i * 3);
        }
        const l = new THREE.LineLoop(new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(pts, 3)), new THREE.LineBasicMaterial({ color: 0xffd166, depthTest: false, transparent: true }));
        l.renderOrder = 8;
        hiGroup.add(l);
      }
    };

    // pincel
    let cursor: Pt | null = null;
    const redrawBrush = () => {
      const { brush, drag } = live.current;
      if (drag) {
        const x0 = Math.min(drag.a[0], drag.b[0]), x1 = Math.max(drag.a[0], drag.b[0]);
        const z0 = Math.min(drag.a[1], drag.b[1]), z1 = Math.max(drag.a[1], drag.b[1]);
        const ya = hAt(drag.a[0], drag.a[1]), yb = hAt(drag.b[0], drag.b[1]);
        dragBox.visible = x1 - x0 > 1 && z1 - z0 > 1;
        dragBox.scale.set(Math.max(1, x1 - x0), Math.abs(ya - yb) + 6, Math.max(1, z1 - z0));
        dragBox.position.set((x0 + x1) / 2, (ya + yb) / 2, (z0 + z1) / 2);
      } else dragBox.visible = false;
      if (!brush || !cursor) { brushLine.visible = false; return; }
      const arr = brushLine.geometry.attributes.position.array as Float32Array;
      const r = brush.shape === "circle" ? brush.radius : 10 * (grid / 1024);
      for (let i = 0; i < 96; i++) {
        const a = (i / 96) * Math.PI * 2;
        const x = Math.max(0, Math.min(grid, cursor[0] + Math.cos(a) * r)), z = Math.max(0, Math.min(grid, cursor[1] + Math.sin(a) * r));
        arr.set([x, hAt(x, z) + 1.5, z], i * 3);
      }
      brushLine.geometry.attributes.position.needsUpdate = true;
      brushLine.geometry.computeBoundingSphere();
      (brushLine.material as THREE.LineBasicMaterial).color.set(brush.color);
      brushLine.visible = true;
    };

    // câmera
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controls.maxPolarAngle = Math.PI * 0.47;
    controls.minDistance = grid * 0.08;
    controls.maxDistance = grid * 2.4;
    controls.screenSpacePanning = false;
    controls.zoomToCursor = true;
    const setOrbit = (on: boolean) => {
      controls.mouseButtons = { LEFT: on ? THREE.MOUSE.ROTATE : null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
      renderer.domElement.style.cursor = on ? "grab" : "crosshair";
    };
    setOrbit(live.current.orbit);
    camera.position.set(grid * 0.5, grid * 0.78, grid * 1.32);
    controls.target.set(grid / 2, 0, grid * 0.52);
    controls.update();

    // seleção por raio
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const pick = (ev: PointerEvent): Pt | null => {
      const r = renderer.domElement.getBoundingClientRect();
      ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const hit = ray.intersectObject(ground, false)[0];
      if (!hit) return null;
      return [Math.round(Math.max(0, Math.min(grid, hit.point.x))), Math.round(Math.max(0, Math.min(grid, hit.point.z)))];
    };
    let down = false;
    const onDown = (ev: PointerEvent) => {
      if (ev.button !== 0 || live.current.orbit) return;
      const p = pick(ev);
      if (!p) return;
      down = true;
      renderer.domElement.setPointerCapture(ev.pointerId);
      live.current.onPointer("down", p);
    };
    let moveQueued = false;
    let lastMove: PointerEvent | null = null;
    const onMove = (ev: PointerEvent) => {
      lastMove = ev;
      if (moveQueued) return;
      moveQueued = true;
      requestAnimationFrame(() => {
        moveQueued = false;
        if (!lastMove) return;
        const p = pick(lastMove);
        cursor = p;
        redrawBrush();
        invalidate();
        if (down) live.current.onPointer("move", p);
      });
    };
    const onUp = (ev: PointerEvent) => {
      if (!down) return;
      down = false;
      renderer.domElement.releasePointerCapture(ev.pointerId);
      live.current.onPointer("up", pick(ev));
    };
    const onLeave = () => { cursor = null; redrawBrush(); invalidate(); };
    const cv = renderer.domElement;
    cv.addEventListener("pointerdown", onDown);
    cv.addEventListener("pointermove", onMove);
    cv.addEventListener("pointerup", onUp);
    cv.addEventListener("pointerleave", onLeave);
    cv.addEventListener("contextmenu", (e) => e.preventDefault());

    // desenha só quando algo muda (câmera, pincel, edição); parado, quase não usa a placa de vídeo.
    // Um quadro a cada 400 ms pega texturas que terminaram de carregar em segundo plano.
    let raf = 0;
    let lastDraw = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (document.hidden) return;
      const moved = controls.update();
      if (moved || dirty || now - lastDraw > 400) {
        renderer.render(scene, camera);
        dirty = false;
        lastDraw = now;
      }
    };
    raf = requestAnimationFrame(tick);

    controls.addEventListener("change", invalidate);
    const ro = new ResizeObserver(() => {
      invalidate();
      camera.aspect = el.clientWidth / Math.max(1, el.clientHeight);
      camera.updateProjectionMatrix();
      renderer.setSize(el.clientWidth, el.clientHeight);
    });
    ro.observe(el);

    if (live.current.snapshotRef) {
      live.current.snapshotRef.current = () => {
        try {
          renderer.render(scene, camera);
          const src = renderer.domElement;
          const c = document.createElement("canvas");
          c.width = 480; c.height = 300;
          const g = c.getContext("2d")!;
          const k = Math.max(480 / src.width, 300 / src.height);
          g.drawImage(src, (480 - src.width * k) / 2, (300 - src.height * k) / 2, src.width * k, src.height * k);
          return c.toDataURL("image/png");
        } catch { return null; }
      };
    }
    // toda mudança na cena pede um quadro novo
    const dirtying = <A extends unknown[]>(f: (...a: A) => void) => (...a: A) => { f(...a); invalidate(); };
    api.current = {
      setHeights: dirtying(setHeights), setTexture: dirtying(setTexture), setMarkers: dirtying(setMarkers), setDecor: dirtying(setDecor), setHighlights: dirtying(setHighlights),
      setOrbit: dirtying(setOrbit), setExaggeration: dirtying(setHeights), redrawBrush: dirtying(redrawBrush),
    };
    setHeights();
    setTexture(live.current.texture);

    return () => {
      api.current = null;
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      cv.removeEventListener("pointerdown", onDown);
      cv.removeEventListener("pointermove", onMove);
      cv.removeEventListener("pointerup", onUp);
      cv.removeEventListener("pointerleave", onLeave);
      clearGroup();
      clearDecor();
      for (const o of [...hiGroup.children]) { const m = o as THREE.Line; m.geometry.dispose(); (m.material as THREE.Material).dispose(); }
      clearTimeout(decorQueued);
      texture?.dispose();
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.Line) {
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
      });
      floor.dispose();
      renderer.dispose();
      el.removeChild(cv);
    };
  }, [props.size, props.grid]);

  useEffect(() => { api.current?.setHeights(); }, [props.heights, props.waterLevel, props.exaggeration, props.palette]);
  useEffect(() => { api.current?.setTexture(props.texture); }, [props.texture]);
  useEffect(() => { api.current?.setMarkers(); }, [props.spawns, props.mass, props.autoMass, props.bridges, props.seed, props.lines]);
  useEffect(() => { api.current?.setDecor(); }, [props.decor, props.cuts]);
  useEffect(() => { api.current?.setHighlights(); }, [props.highlights]);
  useEffect(() => { api.current?.setOrbit(props.orbit); }, [props.orbit]);
  useEffect(() => { api.current?.redrawBrush(); }, [props.brush, props.drag]);

  return <div ref={host} className="map-3d" />;
}
