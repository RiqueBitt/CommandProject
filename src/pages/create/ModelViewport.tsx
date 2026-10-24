// Visão 3D do editor de modelos: peças com material, seleção por clique, gizmo de mover/girar/
// escalar (com encaixe na grade) e edição de vértices de malhas.
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import type { ModelDoc, ModelPart, Vec3 } from "./docs";
import { partGeometry, partMatrix, type TexResolver } from "./modelGeo";

export type GizmoMode = "select" | "translate" | "rotate" | "scale" | "vertex";
export interface TRS { pos: Vec3; rot: Vec3; scale: Vec3 }

interface Props {
  doc: ModelDoc;
  selected: string[];
  mode: GizmoMode;
  snap: { move: number | null; rot: number | null; scale: number | null };
  space: "world" | "local";
  resolveTex: TexResolver;
  teamColor: string;
  wireframe: boolean;
  onPick: (id: string | null, additive: boolean) => void;
  onTransform: (updates: Record<string, TRS>, phase: "start" | "move" | "end") => void;
  vertex: number | null;
  onVertexPick: (i: number | null) => void;
  onVertexMove: (partId: string, index: number, local: Vec3, phase: "start" | "move" | "end") => void;
  snapshotRef?: { current: (() => string | null) | null };
  focusRef?: { current: (() => void) | null };
}

const DEG = Math.PI / 180;
const geoKey = (p: ModelPart) => JSON.stringify([p.type, p.params]);

export default function ModelViewport(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const live = useRef(props);
  live.current = props;
  const api = useRef<{ sync: () => void; setMode: () => void } | null>(null);

  useEffect(() => {
    const el = host.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: false });
    renderer.setPixelRatio(Math.min(1.75, window.devicePixelRatio));
    renderer.setSize(el.clientWidth, el.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x10161d);
    const camera = new THREE.PerspectiveCamera(45, el.clientWidth / Math.max(1, el.clientHeight), 0.05, 2000);
    camera.position.set(9, 7, 11);
    scene.add(new THREE.HemisphereLight(0xe8f0ff, 0x1d2228, 1.3));
    const sun = new THREE.DirectionalLight(0xfff3e0, 2.4);
    sun.position.set(8, 14, 6);
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0x9cc4ff, 0.6);
    fill.position.set(-8, 4, -6);
    scene.add(fill);
    const grid = new THREE.GridHelper(40, 40, 0x3d5268, 0x223040);
    scene.add(grid);
    const axes = new THREE.AxesHelper(1.5);
    axes.position.y = 0.01;
    scene.add(axes);

    const root = new THREE.Group();
    scene.add(root);
    const helpers = new THREE.Group();
    scene.add(helpers);

    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.enableDamping = true;
    orbit.dampingFactor = 0.12;
    orbit.target.set(0, 1.5, 0);
    orbit.update();

    const gizmo = new TransformControls(camera, renderer.domElement);
    const gizmoHelper = gizmo.getHelper();
    scene.add(gizmoHelper);
    const proxy = new THREE.Object3D();
    scene.add(proxy);

    let dirty = true;
    const invalidate = () => { dirty = true; };
    orbit.addEventListener("change", invalidate);
    gizmo.addEventListener("change", invalidate);

    const loader = new THREE.TextureLoader();
    const objs = new Map<string, { mesh: THREE.Mesh; key: string; texRef: string; meshRef: unknown }>();

    const applyMaterial = (mesh: THREE.Mesh, p: ModelPart, texRefHolder: { texRef: string }) => {
      const mat = mesh.material as THREE.MeshStandardMaterial;
      const m = p.material;
      const team = m.team ? new THREE.Color(m.color).lerp(new THREE.Color(live.current.teamColor), 0.65) : new THREE.Color(m.color);
      mat.color.copy(team);
      mat.roughness = m.roughness;
      mat.metalness = m.metalness;
      mat.emissive.set(m.emissive ?? "#000000");
      mat.emissiveIntensity = m.emissive ? 1.2 : 0;
      mat.wireframe = live.current.wireframe;
      const ref = m.texture ? `${m.texture.source}:${m.texture.ref}` : "";
      if (ref !== texRefHolder.texRef) {
        texRefHolder.texRef = ref;
        mat.map?.dispose();
        mat.map = null;
        mat.needsUpdate = true;
        if (m.texture) {
          void live.current.resolveTex(m.texture).then((url) => {
            if (!url || texRefHolder.texRef !== ref) return;
            loader.load(url, (t) => {
              if (texRefHolder.texRef !== ref) { t.dispose(); return; }
              t.colorSpace = THREE.SRGBColorSpace;
              t.wrapS = t.wrapT = THREE.RepeatWrapping;
              t.anisotropy = 4;
              const r = Math.max(1, m.uvScale || 1);
              t.repeat.set(r, r);
              mat.map = t;
              mat.needsUpdate = true;
              invalidate();
            });
          });
        }
      }
      if (mat.map) { const r = Math.max(1, m.uvScale || 1); mat.map.repeat.set(r, r); }
    };

    const boxes: THREE.BoxHelper[] = [];
    let points: THREE.Points | null = null;

    const sync = () => {
      const { doc, selected } = live.current;
      const hiddenGroups = new Set(doc.groups.filter((g) => g.hidden).map((g) => g.id));
      const seen = new Set<string>();
      for (const p of doc.parts) {
        seen.add(p.id);
        let o = objs.get(p.id);
        const key = geoKey(p);
        if (!o) {
          const mesh = new THREE.Mesh(partGeometry(p), new THREE.MeshStandardMaterial({ side: THREE.DoubleSide }));
          mesh.userData.partId = p.id;
          root.add(mesh);
          o = { mesh, key, texRef: "", meshRef: p.mesh };
          objs.set(p.id, o);
        } else if (o.key !== key || o.meshRef !== p.mesh) {
          // forma ou vértices mudaram (documento imutável: malha nova = objeto novo)
          o.mesh.geometry.dispose();
          o.mesh.geometry = partGeometry(p);
          o.key = key;
          o.meshRef = p.mesh;
        }
        const m = partMatrix(p);
        m.decompose(o.mesh.position, o.mesh.quaternion, o.mesh.scale);
        o.mesh.visible = !p.hidden && !(p.group && hiddenGroups.has(p.group));
        applyMaterial(o.mesh, p, o);
      }
      for (const [id, o] of objs) {
        if (!seen.has(id)) {
          root.remove(o.mesh);
          o.mesh.geometry.dispose();
          (o.mesh.material as THREE.MeshStandardMaterial).map?.dispose();
          (o.mesh.material as THREE.Material).dispose();
          objs.delete(id);
        }
      }
      // caixas de seleção
      for (const b of boxes.splice(0)) { helpers.remove(b); b.dispose(); }
      for (const id of selected) {
        const o = objs.get(id);
        if (!o) continue;
        const b = new THREE.BoxHelper(o.mesh, 0xffd166);
        helpers.add(b);
        boxes.push(b);
      }
      setMode();
      invalidate();
    };

    // ------------------------------------------------------------ gizmo
    let start: { proxy: THREE.Matrix4; parts: Record<string, THREE.Matrix4> } | null = null;
    const selectedParts = () => live.current.selected.filter((id) => objs.has(id));

    const placeProxy = () => {
      const ids = selectedParts();
      if (!ids.length) return false;
      if (ids.length === 1) {
        const o = objs.get(ids[0])!.mesh;
        proxy.position.copy(o.position);
        proxy.quaternion.copy(o.quaternion);
        proxy.scale.copy(o.scale);
      } else {
        const c = new THREE.Vector3();
        ids.forEach((id) => c.add(objs.get(id)!.mesh.position));
        proxy.position.copy(c.divideScalar(ids.length));
        proxy.quaternion.identity();
        proxy.scale.set(1, 1, 1);
      }
      proxy.updateMatrixWorld();
      return true;
    };

    const vertexProxy = () => {
      const { mode, vertex, doc, selected } = live.current;
      if (mode !== "vertex" || vertex === null || selected.length !== 1) return false;
      const p = doc.parts.find((x) => x.id === selected[0]);
      if (!p || p.type !== "mesh" || !p.mesh) return false;
      const v = new THREE.Vector3(p.mesh.positions[vertex * 3], p.mesh.positions[vertex * 3 + 1], p.mesh.positions[vertex * 3 + 2]).applyMatrix4(partMatrix(p));
      proxy.position.copy(v);
      proxy.quaternion.identity();
      proxy.scale.set(1, 1, 1);
      proxy.updateMatrixWorld();
      return true;
    };

    const setMode = () => {
      const { mode, snap, space, doc, selected } = live.current;
      // pontos dos vértices
      if (points) { helpers.remove(points); points.geometry.dispose(); (points.material as THREE.Material).dispose(); points = null; }
      if (mode === "vertex" && selected.length === 1) {
        const p = doc.parts.find((x) => x.id === selected[0]);
        if (p?.type === "mesh" && p.mesh) {
          const g = new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(p.mesh.positions, 3));
          g.applyMatrix4(partMatrix(p));
          const cols = new Float32Array((p.mesh.positions.length / 3) * 3).fill(0.85);
          if (live.current.vertex !== null) cols.set([1, 0.82, 0.2], live.current.vertex * 3);
          g.setAttribute("color", new THREE.BufferAttribute(cols, 3));
          points = new THREE.Points(g, new THREE.PointsMaterial({ size: 9, sizeAttenuation: false, vertexColors: true, depthTest: false }));
          points.renderOrder = 10;
          helpers.add(points);
        }
      }
      const ok = mode === "vertex" ? vertexProxy() : mode !== "select" && placeProxy();
      if (ok) {
        gizmo.attach(proxy);
        gizmo.setMode(mode === "vertex" || mode === "select" ? "translate" : mode);
        gizmo.setSpace(mode === "scale" ? "local" : space);
        gizmo.setTranslationSnap(snap.move);
        gizmo.setRotationSnap(snap.rot ? snap.rot * DEG : null);
        gizmo.setScaleSnap(snap.scale);
        gizmo.showY = true;
      } else gizmo.detach();
      invalidate();
    };

    gizmo.addEventListener("dragging-changed", (e) => {
      orbit.enabled = !(e as unknown as { value: boolean }).value;
      const dragging = (e as unknown as { value: boolean }).value;
      const { mode } = live.current;
      if (dragging) {
        start = { proxy: proxy.matrixWorld.clone(), parts: {} };
        for (const id of selectedParts()) start.parts[id] = objs.get(id)!.mesh.matrix.clone();
        if (mode === "vertex") emitVertex("start");
        else emit("start");
      } else {
        if (mode === "vertex") emitVertex("end");
        else emit("end");
        start = null;
      }
    });
    gizmo.addEventListener("objectChange", () => {
      if (live.current.mode === "vertex") emitVertex("move");
      else emit("move");
    });

    const r2 = (v: number) => Math.round(v * 1000) / 1000;
    const emit = (phase: "start" | "move" | "end") => {
      if (!start) return;
      proxy.updateMatrixWorld();
      const delta = proxy.matrixWorld.clone().multiply(start.proxy.clone().invert());
      const out: Record<string, TRS> = {};
      const pos = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(), eu = new THREE.Euler();
      for (const [id, m0] of Object.entries(start.parts)) {
        const m = selectedParts().length === 1 ? proxy.matrixWorld.clone() : delta.clone().multiply(m0);
        m.decompose(pos, q, s);
        eu.setFromQuaternion(q, "XYZ");
        out[id] = { pos: [r2(pos.x), r2(pos.y), r2(pos.z)], rot: [r2(eu.x / DEG), r2(eu.y / DEG), r2(eu.z / DEG)], scale: [r2(s.x), r2(s.y), r2(s.z)] };
      }
      live.current.onTransform(out, phase);
    };
    const emitVertex = (phase: "start" | "move" | "end") => {
      const { doc, selected, vertex } = live.current;
      const p = doc.parts.find((x) => x.id === selected[0]);
      if (!p || vertex === null) return;
      const local = proxy.position.clone().applyMatrix4(partMatrix(p).invert());
      live.current.onVertexMove(p.id, vertex, [r2(local.x), r2(local.y), r2(local.z)], phase);
    };

    // ------------------------------------------------------------ clique para selecionar
    const ray = new THREE.Raycaster();
    ray.params.Points = { threshold: 0.15 };
    const ndc = new THREE.Vector2();
    let downAt: [number, number] | null = null;
    const cv = renderer.domElement;
    const onDown = (e: PointerEvent) => { if (e.button === 0) downAt = [e.clientX, e.clientY]; };
    const onUp = (e: PointerEvent) => {
      if (e.button !== 0 || !downAt || gizmo.dragging) { downAt = null; return; }
      const moved = Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]);
      downAt = null;
      if (moved > 4) return; // girou a câmera
      const r = cv.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      if (live.current.mode === "vertex" && points) {
        ray.params.Points = { threshold: camera.position.distanceTo(orbit.target) * 0.012 };
        const hit = ray.intersectObject(points)[0];
        if (hit && hit.index !== undefined) { live.current.onVertexPick(hit.index); return; }
      }
      const lockedIds = new Set(live.current.doc.parts.filter((q) => q.locked).map((q) => q.id));
      const hits = ray.intersectObjects([...objs.values()].filter((o) => o.mesh.visible && !lockedIds.has(o.mesh.userData.partId as string)).map((o) => o.mesh), false);
      live.current.onPick(hits[0] ? (hits[0].object.userData.partId as string) : null, e.shiftKey || e.ctrlKey);
    };
    cv.addEventListener("pointerdown", onDown);
    cv.addEventListener("pointerup", onUp);

    // ------------------------------------------------------------ laço de desenho sob demanda
    let raf = 0;
    let last = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (document.hidden || el.offsetParent === null) return;
      const moved = orbit.update();
      if (moved || dirty || now - last > 500) {
        for (const b of boxes) b.update();
        renderer.render(scene, camera);
        dirty = false;
        last = now;
      }
    };
    raf = requestAnimationFrame(tick);
    const ro = new ResizeObserver(() => {
      camera.aspect = el.clientWidth / Math.max(1, el.clientHeight);
      camera.updateProjectionMatrix();
      renderer.setSize(el.clientWidth, el.clientHeight);
      invalidate();
    });
    ro.observe(el);

    if (live.current.snapshotRef) {
      live.current.snapshotRef.current = () => {
        try {
          gizmoHelper.visible = false; helpers.visible = false; grid.visible = false; axes.visible = false;
          renderer.render(scene, camera);
          const c = document.createElement("canvas");
          c.width = 480; c.height = 300;
          const g = c.getContext("2d")!;
          const src = renderer.domElement;
          const k = Math.max(480 / src.width, 300 / src.height);
          g.drawImage(src, (480 - src.width * k) / 2, (300 - src.height * k) / 2, src.width * k, src.height * k);
          return c.toDataURL("image/png");
        } catch { return null; } finally {
          gizmoHelper.visible = true; helpers.visible = true; grid.visible = true; axes.visible = true;
          invalidate();
        }
      };
    }
    if (live.current.focusRef) {
      live.current.focusRef.current = () => {
        const box = new THREE.Box3();
        const ids = live.current.selected.length ? live.current.selected : [...objs.keys()];
        ids.forEach((id) => { const o = objs.get(id); if (o) box.expandByObject(o.mesh); });
        if (box.isEmpty()) return;
        const c = box.getCenter(new THREE.Vector3());
        const r = Math.max(1, box.getSize(new THREE.Vector3()).length());
        const dir = camera.position.clone().sub(orbit.target).normalize();
        orbit.target.copy(c);
        camera.position.copy(c.clone().add(dir.multiplyScalar(r * 1.4)));
        invalidate();
      };
    }

    api.current = { sync, setMode };
    sync();

    return () => {
      api.current = null;
      cancelAnimationFrame(raf);
      ro.disconnect();
      cv.removeEventListener("pointerdown", onDown);
      cv.removeEventListener("pointerup", onUp);
      gizmo.detach();
      gizmo.dispose();
      orbit.dispose();
      for (const o of objs.values()) { o.mesh.geometry.dispose(); (o.mesh.material as THREE.MeshStandardMaterial).map?.dispose(); (o.mesh.material as THREE.Material).dispose(); }
      for (const b of boxes) b.dispose();
      renderer.dispose();
      el.removeChild(cv);
    };
  }, []);

  useEffect(() => { api.current?.sync(); }, [props.doc, props.selected, props.wireframe, props.teamColor]);
  useEffect(() => { api.current?.setMode(); }, [props.mode, props.snap, props.space, props.vertex]);

  return <div ref={host} className="viewport model-viewport" />;
}
