import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { heightAt, type Pt, type Rect } from "../pages/studio/mapEdit";

export interface Marker { p: Pt; color: string; label: string }
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
  /** câmera livre: o botão esquerdo gira em vez de editar */
  orbit: boolean;
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
    setOrbit: (on: boolean) => void;
    setExaggeration: () => void;
    redrawBrush: () => void;
  } | null>(null);

  // cena: criada uma vez por terreno
  useEffect(() => {
    const el = host.current!;
    const { size, grid } = live.current;
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
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
      for (let k = 0; k < w * w; k++) {
        pos[k * 3 + 1] = heights[k] * e;
        colorFor(heights[k], waterLevel, lo, hi, c);
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
        if (down) live.current.onPointer("move", p);
      });
    };
    const onUp = (ev: PointerEvent) => {
      if (!down) return;
      down = false;
      renderer.domElement.releasePointerCapture(ev.pointerId);
      live.current.onPointer("up", pick(ev));
    };
    const onLeave = () => { cursor = null; redrawBrush(); };
    const cv = renderer.domElement;
    cv.addEventListener("pointerdown", onDown);
    cv.addEventListener("pointermove", onMove);
    cv.addEventListener("pointerup", onUp);
    cv.addEventListener("pointerleave", onLeave);
    cv.addEventListener("contextmenu", (e) => e.preventDefault());

    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (document.hidden) return;
      controls.update();
      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(tick);

    const ro = new ResizeObserver(() => {
      camera.aspect = el.clientWidth / Math.max(1, el.clientHeight);
      camera.updateProjectionMatrix();
      renderer.setSize(el.clientWidth, el.clientHeight);
    });
    ro.observe(el);

    api.current = { setHeights, setTexture, setMarkers, setOrbit, setExaggeration: setHeights, redrawBrush };
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

  useEffect(() => { api.current?.setHeights(); }, [props.heights, props.waterLevel, props.exaggeration]);
  useEffect(() => { api.current?.setTexture(props.texture); }, [props.texture]);
  useEffect(() => { api.current?.setMarkers(); }, [props.spawns, props.mass, props.autoMass, props.bridges, props.seed]);
  useEffect(() => { api.current?.setOrbit(props.orbit); }, [props.orbit]);
  useEffect(() => { api.current?.redrawBrush(); }, [props.brush, props.drag]);

  return <div ref={host} className="map-3d" />;
}
