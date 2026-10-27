import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { fbm, zoneT } from "../pages/studio/biome";
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
  /** texturas reais do chão (do terreno base) misturadas pela altura e inclinação, com a paleta */
  ground?: GroundTextures | null;
  /** cor do céu escolhido (fundo e névoa da prévia); null = a cor padrão */
  sky?: [number, number, number] | null;
  /** passagem das tropas por vértice: 0 livre, 1 íngreme/água, 2 bloqueado à mão, 3 liberado à mão */
  pass?: Uint8Array | null;
  onPointer: (type: "down" | "move" | "up", p: Pt | null) => void;
  /** pedido de câmera (o número muda a cada pedido): jogo, passeio, de cima ou livre */
  cameraRequest?: { mode: "game" | "tour" | "top" | "free"; n: number } | null;
  /** a câmera voltou a ser livre (o passeio parou) */
  onCamera?: (mode: "free") => void;
}

const SKY = 0x0b1118;

/** Texturas do chão para as cores do relevo: praia, chão, rocha (encostas) e topo. */
export interface GroundTextures {
  sand: string; grass: string; rock: string; snow: string;
  /** 5ª camada (terra), usada com `t` */
  dirt?: string;
  /** tabuleiro das pontes (t = 5) */
  deck?: string | null;
  /** repetições da textura por unidade (a mesma do jogo); sem isso, o padrão da prévia */
  tile?: number;
  /** uma textura só no chão inteiro, sem tinta da paleta */
  uniform?: boolean;
  /** posição de cada vértice na cadeia praia(0)→chão(1)→terra(2)→rocha(3)→topo(4), como no jogo */
  t?: Float32Array | null;
  /** paisagem em volta do mapa (como no jogo): largura e altura das montanhas */
  ring?: { margin: number; rise: number; water: number | null } | null;
}

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
    setGround: () => void;
    setSky: () => void;
    camera: (mode: "game" | "tour" | "top" | "free") => void;
  } | null>(null);

  // contexto WebGL perdido (driver, falta de memória de vídeo, muitos contextos abertos): a cena é
  // refeita quando o navegador devolver o contexto, em vez de a vista ficar branca
  const [ctxGen, setCtxGen] = useState(0);

  // cena: criada uma vez por terreno
  useEffect(() => {
    const el = host.current!;
    const { size, grid } = live.current;
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    const onLost = (e: Event) => { e.preventDefault(); };
    const onRestored = () => setCtxGen((g) => g + 1);
    renderer.domElement.addEventListener("webglcontextlost", onLost);
    renderer.domElement.addEventListener("webglcontextrestored", onRestored);
    renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio));
    let dirty = true;
    const invalidate = () => { dirty = true; };
    renderer.setSize(el.clientWidth, el.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    // sombras do sol: montanhas, árvores e prédios
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
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
    const splat = new Float32Array(w * w * 4);
    const splatB = new Float32Array(w * w);
    const splatC = new Float32Array(w * w);
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
    geo.setAttribute("splat", new THREE.BufferAttribute(splat, 4));
    geo.setAttribute("splatB", new THREE.BufferAttribute(splatB, 1));
    geo.setAttribute("splatC", new THREE.BufferAttribute(splatC, 1));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0, vertexColors: true });
    // chão com texturas: 4 camadas misturadas por vértice (praia, chão, rocha, topo), em dois
    // tamanhos para não parecer azulejo
    const groundU = {
      tSand: { value: null as THREE.Texture | null }, tGrass: { value: null as THREE.Texture | null },
      tRock: { value: null as THREE.Texture | null }, tSnow: { value: null as THREE.Texture | null },
      tDirt: { value: null as THREE.Texture | null }, tDeck: { value: null as THREE.Texture | null },
      uGround: { value: 0 }, uTile: { value: 1 / 22 }, uExact: { value: 0 },
    };
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, groundU);
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nattribute vec4 splat;\nattribute float splatB;\nattribute float splatC;\nvarying vec4 vSplat;\nvarying float vSplatB;\nvarying float vSplatC;\nvarying vec2 vGround;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvSplat = splat;\nvSplatB = splatB;\nvSplatC = splatC;\nvGround = position.xz;");
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", `#include <common>
uniform sampler2D tSand; uniform sampler2D tGrass; uniform sampler2D tRock; uniform sampler2D tSnow; uniform sampler2D tDirt; uniform sampler2D tDeck;
uniform float uGround; uniform float uTile; uniform float uExact;
varying vec4 vSplat; varying float vSplatB; varying float vSplatC; varying vec2 vGround;
vec3 layerAt(vec2 p) {
  float tot = max(0.0001, dot(vSplat, vec4(1.0)) + vSplatB + vSplatC);
  vec3 c = texture2D(tSand, p).rgb * vSplat.x + texture2D(tGrass, p).rgb * vSplat.y + texture2D(tRock, p).rgb * vSplat.z + texture2D(tSnow, p).rgb * vSplat.w;
  if (vSplatB > 0.001) c += texture2D(tDirt, p).rgb * vSplatB;
  if (vSplatC > 0.001) c += texture2D(tDeck, p).rgb * vSplatC;
  return c / tot;
}`)
        .replace("#include <map_fragment>", `#include <map_fragment>
if (uGround > 0.5) {
  vec2 p = vGround * uTile;
  vec3 c;
  if (uExact > 0.5) c = layerAt(p); // como no jogo: uma escala só
  else { vec2 q = mat2(0.8, -0.6, 0.6, 0.8) * vGround * uTile * 0.23 + 0.37; c = mix(layerAt(p), layerAt(q), 0.35); }
  diffuseColor.rgb *= c * 0.62;
}`);
    };
    mat.customProgramCacheKey = () => "cp-ground7";
    const ground = new THREE.Mesh(geo, mat);
    ground.receiveShadow = true;
    ground.castShadow = true;
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

    // paisagem em volta do mapa (mesmo cálculo do jogo: cp_world.ring_height)
    let ringMesh: THREE.Mesh | null = null;
    let ringKey = "";
    let ringSig = "";
    const setRing = (e: number, lo: number, hi: number) => {
      const r = live.current.ground?.ring;
      const { heights } = live.current;
      const key = r ? `${r.margin}:${r.rise}:${r.water}` : "";
      if (!r) {
        if (ringMesh) { scene.remove(ringMesh); ringMesh.geometry.dispose(); ringMesh = null; ringKey = ""; }
        skirt.visible = true;
        return;
      }
      skirt.visible = false;
      // a paisagem em volta só depende da borda do mapa: refaz só se a borda (ou a altura) mudou
      let edgeSum = 0;
      for (let i = 0; i < w; i += 2) edgeSum += heights[i] + heights[size * w + i] + heights[i * w] + heights[i * w + size];
      const sig = `${key}:${e}:${Math.round(lo)}:${Math.round(hi)}:${Math.round(edgeSum * 10)}`;
      if (ringMesh && sig === ringSig) return;
      ringSig = sig;
      const R = Math.max(8, grid / 64), M = Math.ceil(r.margin / R) * R;
      const n = Math.round((grid + 2 * M) / R) + 1;
      const hIn = (x: number, z: number) => {
        const fx = Math.max(0, Math.min(size, x / step)), fz = Math.max(0, Math.min(size, z / step));
        const i0 = Math.min(size - 1, Math.floor(fx)), j0 = Math.min(size - 1, Math.floor(fz)), u = fx - i0, v = fz - j0;
        const a = heights[j0 * w + i0], b = heights[j0 * w + i0 + 1], c = heights[(j0 + 1) * w + i0], d = heights[(j0 + 1) * w + i0 + 1];
        return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
      };
      const hAt = (x: number, z: number) => {
        const cx = Math.max(0, Math.min(grid, x)), cz = Math.max(0, Math.min(grid, z));
        const base = hIn(cx, cz), d = Math.hypot(x - cx, z - cz);
        if (d <= 0) return base;
        const t = Math.min(1, d / 220), k = t * t * (3 - 2 * t);
        const big = 0.55 + 0.45 * fbm(x / 260, z / 260, 4242);
        const crag = 1 - Math.abs(fbm(x / 70, z / 70, 4249));
        return base + r.rise * k * big + 22 * k * crag * crag;
      };
      const P = new Float32Array(n * n * 3), C = new Float32Array(n * n * 3).fill(1), S = new Float32Array(n * n * 4), SB = new Float32Array(n * n), U = new Float32Array(n * n * 2);
      const ee = grid / 256;
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const k = j * n + i, x = -M + i * R, z = -M + j * R;
        const y = hAt(x, z);
        P.set([x, y * e, z], k * 3);
        const dx = (hAt(x + ee, z) - hAt(x - ee, z)) / (2 * ee), dz = (hAt(x, z + ee) - hAt(x, z - ee)) / (2 * ee);
        const tv = zoneT(y, Math.hypot(dx, dz), (y - lo) / Math.max(1, hi - lo), r.water, fbm(x / 90, z / 90, 1337));
        const wt = (q: number) => Math.max(0, 1 - Math.abs(tv - q));
        S.set([wt(0), wt(1), wt(3), wt(4)], k * 4);
        SB[k] = wt(2);
      }
      const I: number[] = [];
      const inner = (i: number, j: number) => { const x = -M + i * R, z = -M + j * R; return x >= 0 && z >= 0 && x + R <= grid && z + R <= grid; };
      for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
        if (inner(i, j)) continue;
        const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
        I.push(a, c, b, b, c, d);
      }
      const g2 = new THREE.BufferGeometry();
      g2.setAttribute("position", new THREE.BufferAttribute(P, 3));
      g2.setAttribute("uv", new THREE.BufferAttribute(U, 2));
      g2.setAttribute("color", new THREE.BufferAttribute(C, 3));
      g2.setAttribute("splat", new THREE.BufferAttribute(S, 4));
      g2.setAttribute("splatB", new THREE.BufferAttribute(SB, 1));
      g2.setAttribute("splatC", new THREE.BufferAttribute(new Float32Array(SB.length), 1));
      g2.setIndex(I);
      g2.computeVertexNormals();
      if (ringMesh) { ringMesh.geometry.dispose(); ringMesh.geometry = g2; } else {
        ringMesh = new THREE.Mesh(g2, mat);
        ringMesh.receiveShadow = true;
        scene.add(ringMesh);
      }
      ringKey = key;
    };
    void ringKey;

    // água
    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(grid, grid),
      new THREE.MeshStandardMaterial({ color: 0x2b6c9e, transparent: true, opacity: 0.7, roughness: 0.62, metalness: 0, depthWrite: false }),
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
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -grid * 0.8; sun.shadow.camera.right = grid * 0.8;
    sun.shadow.camera.top = grid * 0.8; sun.shadow.camera.bottom = -grid * 0.8;
    sun.shadow.camera.near = 1; sun.shadow.camera.far = grid * 3;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 1.2;
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

    // texturas do chão (só nas cores do relevo, sem a textura do jogo por cima)
    const groundTex: THREE.Texture[] = [];
    let groundKey = "";
    const setGround = () => {
      const g = live.current.ground;
      groundU.uTile.value = g?.tile ? g.tile : 1 / 22;
      groundU.uExact.value = g?.tile ? 1 : 0;
      const key = g ? `${g.uniform ? "u" : ""}${g.sand.length}:${g.grass.slice(-40)}:${g.rock.slice(-40)}:${g.snow.slice(-40)}:${(g.dirt ?? "").slice(-40)}:${(g.deck ?? "").slice(-40)}` : "";
      if (key === groundKey) { if (groundU.uGround.value > 0.5) scheduleHeights(); return; }
      groundKey = key;
      groundTex.splice(0).forEach((t) => t.dispose());
      groundU.uGround.value = 0;
      if (!g) { invalidate(); return; }
      const urls = [g.sand, g.grass, g.rock, g.snow, g.dirt ?? g.grass, g.deck ?? g.rock];
      let done = 0;
      const slots = [groundU.tSand, groundU.tGrass, groundU.tRock, groundU.tSnow, groundU.tDirt, groundU.tDeck];
      urls.forEach((u, k) => loader.load(u, (t) => {
        if (groundKey !== key) { t.dispose(); return; }
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = renderer.capabilities.getMaxAnisotropy();
        groundTex.push(t);
        slots[k].value = t;
        if (++done === urls.length) { groundU.uGround.value = 1; setHeights(); invalidate(); }
      }));
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
      const textured = !!pal && groundU.uGround.value > 0.5;
      const wet = waterLevel > 0.5;
      const base = Math.max(lo, wet ? waterLevel : lo);
      const gtFast = textured && !!live.current.ground?.t && live.current.ground.t.length === w * w;
      for (let k = 0; k < w * w; k++) {
        pos[k * 3 + 1] = heights[k] * e;
        if (pal) {
          const i = k % w, j = (k - i) / w;
          const dx = (heights[Math.min(k + 1, j * w + size)] - heights[Math.max(k - 1, j * w)]) / (2 * st);
          const dz = (heights[Math.min(k + w, w * w - 1)] - heights[Math.max(k - w, 0)]) / (2 * st);
          const sl = Math.hypot(dx, dz), y = heights[k];
          // chão do jogo (textura por papel): a cor da paleta não aparece, nem precisa ser calculada
          if (gtFast) c.setRGB(1, 1, 1);
          else { const [r, g, b] = naturalColor(y, sl, waterLevel, wet, lo, hi, pal, 1); c.setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace); }
          // pesos das camadas: praia perto da água, rocha nas encostas, topo nas partes altas
          const t = Math.max(0, Math.min(1, (y - base) / Math.max(1, hi - base)));
          const sm = (a: number, b2: number, x: number) => { const q = Math.max(0, Math.min(1, (x - a) / (b2 - a))); return q * q * (3 - 2 * q); };
          const rock = sm(0.45, 1.05, sl);
          const snow = (pal === "snow" ? 0.55 + 0.45 * sm(0.4, 0.8, t) : sm(0.7, 0.9, t)) * (1 - rock * 0.6);
          const sand = (wet ? sm(waterLevel + 4.5, waterLevel + 1, y) : 0) * (1 - rock);
          const grass = Math.max(0, 1 - rock - snow - sand);
          const gt = live.current.ground?.t;
          if (gt && gt.length === w * w) {
            // cadeia do jogo: pesos em "tenda" em volta de cada papel
            const tv = gt[k], wt = (r: number) => Math.max(0, 1 - Math.abs(tv - r));
            // t = 5: tabuleiro das pontes (sem mistura com o chão)
            if (tv > 4.5) { splat.set([0, 0, 0, 0], k * 4); splatB[k] = 0; splatC[k] = 1; }
            else { splat.set([wt(0), wt(1), wt(3), wt(4)], k * 4); splatB[k] = wt(2); splatC[k] = 0; }
          } else {
            splat.set([sand, grass, rock, snow], k * 4);
            splatB[k] = 0;
            splatC[k] = 0;
          }
          // com textura, a paleta só tinge de leve (a cor vem da textura do jogo)
          // (chão de uma textura só, o "visual limpo": sem tinta — fica como no jogo)
          if (textured) { if (live.current.ground?.uniform || live.current.ground?.t) c.setRGB(1, 1, 1); else c.setRGB(0.8 + c.r * 0.3, 0.8 + c.g * 0.3, 0.8 + c.b * 0.3); }
        } else colorFor(heights[k], waterLevel, lo, hi, c);
        const pc = live.current.pass?.[k];
        if (pc === 1) c.setRGB(c.r * 1.0 + 0.25, c.g * 0.55, c.b * 0.55);
        else if (pc === 2) c.setRGB(c.r * 0.6 + 0.55, c.g * 0.3, c.b * 0.3);
        else if (pc === 3) c.setRGB(c.r * 0.45, c.g * 0.6 + 0.45, c.b * 0.45);
        col.set([c.r, c.g, c.b], k * 3);
      }
      geo.attributes.splat.needsUpdate = true;
      geo.attributes.splatB.needsUpdate = true;
      geo.attributes.splatC.needsUpdate = true;
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
      const rw = live.current.ground?.ring?.water;
      setRing(e, rw != null ? Math.max(lo, rw) : lo, Math.max(hi, (rw != null ? Math.max(lo, rw) : lo) + 120));
      water.position.y = waterLevel * e;
      water.visible = waterLevel > lo + 0.5;
      // com a paisagem em volta, a água vai até o horizonte (como a lâmina d'água do jogo)
      water.scale.setScalar(live.current.ground?.ring && waterLevel > 0.5 ? 3 : 1);
      // marcadores e decorações acompanham o chão um instante depois (não a cada pincelada)
      if (heightsTimer) window.clearTimeout(heightsTimer);
      heightsTimer = window.setTimeout(() => { heightsTimer = 0; setMarkers(); setDecor(); setHighlights(); invalidate(); }, 140);
      redrawBrush();
    };
    let heightsTimer = 0;
    // várias mudanças no mesmo quadro (pincel, pintura) viram uma atualização só
    let heightsFrame = 0;
    const scheduleHeights = () => {
      if (heightsFrame) return;
      heightsFrame = requestAnimationFrame(() => { heightsFrame = 0; setHeights(); invalidate(); });
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
      mass.forEach((p) => gem(p, 0x7bd88f, 6));
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
      // enquanto o modelo do jogo carrega (ou se não houver): formas do tamanho típico no jogo
      tree: () => new THREE.ConeGeometry(0.9, 2.8, 7).translate(0, 1.4, 0),
      rock: () => new THREE.DodecahedronGeometry(0.8, 0).scale(1, 0.6, 1).translate(0, 0.3, 0),
      building: () => new THREE.BoxGeometry(6, 5, 6).translate(0, 2.5, 0),
      wreck: () => new THREE.BoxGeometry(2.5, 0.8, 1.6).translate(0, 0.4, 0),
      other: () => new THREE.OctahedronGeometry(0.7).translate(0, 0.7, 0),
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
        const plain = new THREE.Color(0xffffff);
        list.forEach((d, i) => {
          q.setFromAxisAngle(up, (d.yaw * Math.PI) / 180);
          const s = Math.max(0.01, d.scale || 1);
          sc.set(s, s, s);
          v.set(d.x, hAt(d.x, d.z), d.z);
          mesh.setMatrixAt(i, m4.compose(v, q, sc));
          mesh.setColorAt(i, plain); // cor real da textura (antes as colocadas ficavam esverdeadas)
        });
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.computeBoundingSphere();
        mesh.castShadow = true;
        mesh.receiveShadow = true;
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
    // passeio: a câmera dá a volta no mapa, alta e olhando para o centro (para no primeiro clique)
    let tour: { a: number; last: number } | null = null;
    const stopTour = () => { if (tour) { tour = null; live.current.onCamera?.("free"); } };
    renderer.domElement.addEventListener("pointerdown", stopTour);
    renderer.domElement.addEventListener("wheel", stopTour, { passive: true });
    const setCamera = (mode: "game" | "tour" | "top" | "free") => {
      tour = null;
      const t = controls.target;
      if (mode === "game") {
        // como a câmera do jogo no zoom padrão: bem inclinada, olhando de cima para o chão
        const dist = grid * 0.24, pitch = (62 * Math.PI) / 180;
        camera.position.set(t.x, t.y + dist * Math.sin(pitch), t.z + dist * Math.cos(pitch));
      } else if (mode === "top") {
        controls.target.set(grid / 2, 0, grid / 2);
        camera.position.set(grid / 2, grid * 1.25, grid / 2 + 0.01);
      } else if (mode === "tour") {
        controls.target.set(grid / 2, 0, grid / 2);
        tour = { a: Math.atan2(camera.position.z - grid / 2, camera.position.x - grid / 2), last: performance.now() };
      }
      controls.update();
      invalidate();
    };
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (document.hidden) return;
      if (tour) {
        const dt = Math.min(0.05, (now - tour.last) / 1000);
        tour.last = now;
        tour.a += dt * 0.18;
        const R = grid * 0.62, bob = Math.sin(tour.a * 2) * grid * 0.05;
        camera.position.set(grid / 2 + Math.cos(tour.a) * R, grid * 0.38 + bob, grid / 2 + Math.sin(tour.a) * R);
        controls.target.set(grid / 2, 0, grid / 2);
        dirty = true;
      }
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
    // céu: fundo em degradê suave a partir da cor média do céu escolhido (horizonte mais claro)
    const setSky = () => {
      const c = live.current.sky;
      const base = c ? new THREE.Color(c[0] / 255, c[1] / 255, c[2] / 255) : new THREE.Color(SKY);
      // a prévia é escura: o céu entra mais apagado para não ofuscar o mapa
      const bg = c ? base.clone().lerp(new THREE.Color(SKY), 0.35) : base;
      (scene.background as THREE.Color).copy(bg);
      (scene.fog as THREE.Fog).color.copy(bg);
    };
    api.current = {
      camera: setCamera,
      setSky: dirtying(setSky),
      setHeights: scheduleHeights, setTexture: dirtying(setTexture), setMarkers: dirtying(setMarkers), setDecor: dirtying(setDecor), setHighlights: dirtying(setHighlights),
      setOrbit: dirtying(setOrbit), setExaggeration: scheduleHeights, redrawBrush: dirtying(redrawBrush), setGround: dirtying(setGround),
    };
    setGround();
    setSky();
    setHeights();
    try { if (localStorage.getItem("cpFixture") === "1") (window as unknown as { __map3d: unknown }).__map3d = { mat, groundU, splat, col, renderer, scene, live }; } catch { /* sem depuração */ }
    setTexture(live.current.texture);

    return () => {
      api.current = null;
      if (heightsFrame) cancelAnimationFrame(heightsFrame);
      if (heightsTimer) window.clearTimeout(heightsTimer);
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      cv.removeEventListener("pointerdown", onDown);
      cv.removeEventListener("pointermove", onMove);
      cv.removeEventListener("pointerup", onUp);
      cv.removeEventListener("pointerleave", onLeave);
      cv.removeEventListener("pointerdown", stopTour);
      cv.removeEventListener("wheel", stopTour);
      clearGroup();
      clearDecor();
      for (const o of [...hiGroup.children]) { const m = o as THREE.Line; m.geometry.dispose(); (m.material as THREE.Material).dispose(); }
      clearTimeout(decorQueued);
      texture?.dispose();
      groundTex.forEach((t) => t.dispose());
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.Line) {
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
      });
      floor.dispose();
      renderer.domElement.removeEventListener("webglcontextlost", onLost);
      renderer.domElement.removeEventListener("webglcontextrestored", onRestored);
      renderer.dispose();
      el.removeChild(cv);
    };
  }, [props.size, props.grid, ctxGen]);

  useEffect(() => { api.current?.setHeights(); }, [props.heights, props.waterLevel, props.exaggeration, props.palette, props.pass]);
  useEffect(() => { api.current?.setTexture(props.texture); }, [props.texture]);
  useEffect(() => { api.current?.setGround(); }, [props.ground]);
  useEffect(() => { api.current?.setSky(); }, [props.sky]);
  useEffect(() => { api.current?.setMarkers(); }, [props.spawns, props.mass, props.autoMass, props.bridges, props.seed, props.lines]);
  useEffect(() => { api.current?.setDecor(); }, [props.decor, props.cuts]);
  useEffect(() => { api.current?.setHighlights(); }, [props.highlights]);
  useEffect(() => { api.current?.setOrbit(props.orbit); }, [props.orbit]);
  useEffect(() => { api.current?.redrawBrush(); }, [props.brush, props.drag]);
  useEffect(() => { if (props.cameraRequest) api.current?.camera(props.cameraRequest.mode); }, [props.cameraRequest]);

  return <div ref={host} className="map-3d" />;
}
