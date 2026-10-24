// Prévia 3D da tropa: malha do jogo (ou do modelo próprio) com ossos, textura com o ajuste de cor,
// cor do time e animações .sca tocando em tempo real.
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { BakedModel, ScaAnimation, UnitPreview } from "../../lib/types";

export interface ViewModel {
  positions: number[]; normals: number[]; uvs: number[]; indices: number[]; boneIndex: number[];
  /** ossos: nome, pai, posição e rotação em relação ao pai */
  bones: { name: string; parent: number; pos: [number, number, number]; rot: [number, number, number, number] }[];
  albedo: string | null;
  team: string | null;
  /** o modelo do jogo usa UVs sem inverter */
  flipY: boolean;
}

export function viewFromPreview(p: UnitPreview): ViewModel {
  return {
    positions: p.mesh.positions, normals: p.mesh.normals, uvs: p.mesh.uvs, indices: p.mesh.indices, boneIndex: p.boneIndex,
    bones: p.mesh.bones.map((b) => ({ name: b.name, parent: b.parent, pos: b.position, rot: b.rotation ?? [1, 0, 0, 0] })),
    albedo: p.albedo, team: p.team, flipY: false,
  };
}

export function viewFromBaked(b: BakedModel): ViewModel {
  return {
    positions: b.positions, normals: b.normals, uvs: b.uvs, indices: b.indices, boneIndex: b.boneIndex,
    bones: b.bones.map((x) => ({ name: x.name, parent: x.parent, pos: x.pos, rot: x.rot })),
    albedo: b.albedoPng.startsWith("data:") ? b.albedoPng : `data:image/png;base64,${b.albedoPng}`,
    team: b.teamPng ? (b.teamPng.startsWith("data:") ? b.teamPng : `data:image/png;base64,${b.teamPng}`) : null, flipY: false,
  };
}

interface Props {
  model: ViewModel | null;
  tint: { hue: number; sat: number; bright: number };
  /** textura importada que substitui a do jogo */
  albedoOverride: string | null;
  teamColor: string;
  anim: ScaAnimation | null;
  playing: boolean;
  speed: number;
  onTime?: (t: number) => void;
  snapshotRef?: { current: (() => string | null) | null };
  /** foto quadrada com fundo transparente (ícone da tropa) */
  iconRef?: { current: (() => string | null) | null };
  /** pincel para pintar direto no modelo (na textura de cor) */
  paint?: { on: boolean; color: string; size: number; opacity: number } | null;
  /** fim de uma pincelada: a textura pintada (PNG) */
  onPainted?: (png: string) => void;
  /** com a animação parada: mostra este instante */
  seek?: number | null;
}

const q4 = (r: [number, number, number, number]) => new THREE.Quaternion(r[1], r[2], r[3], r[0]);

export default function UnitViewport(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const live = useRef(props);
  live.current = props;
  const api = useRef<{ setModel: () => void; setLook: () => void; setAnim: () => void } | null>(null);

  useEffect(() => {
    const el = host.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: false });
    renderer.setPixelRatio(Math.min(1.75, window.devicePixelRatio));
    renderer.setSize(el.clientWidth, el.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0f141b);
    const camera = new THREE.PerspectiveCamera(40, el.clientWidth / Math.max(1, el.clientHeight), 0.01, 500);
    scene.add(new THREE.HemisphereLight(0xe6eeff, 0x1a1f26, 1.2));
    const sun = new THREE.DirectionalLight(0xfff2de, 2.6);
    sun.position.set(4, 8, 5);
    scene.add(sun);
    const rim = new THREE.DirectionalLight(0x88b4ff, 0.9);
    rim.position.set(-5, 3, -6);
    scene.add(rim);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(1, 64), new THREE.MeshStandardMaterial({ color: 0x1a222c, roughness: 0.95 }));
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.98, 1, 96), new THREE.MeshBasicMaterial({ color: 0xa3e635, transparent: true, opacity: 0.5 }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.002;
    scene.add(ring);
    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.enableDamping = true;
    orbit.autoRotate = true;
    orbit.autoRotateSpeed = 0.8;
    orbit.addEventListener("start", () => { orbit.autoRotate = false; });

    const holder = new THREE.Group();
    scene.add(holder);
    let mesh: THREE.SkinnedMesh | null = null;
    let bones: THREE.Bone[] = [];
    let rest: { p: THREE.Vector3; q: THREE.Quaternion }[] = [];
    let baseImg: HTMLImageElement | null = null;
    let teamImg: HTMLImageElement | null = null;
    const canvas = document.createElement("canvas");
    // textura "crua" (sem ajuste de cor), onde o pincel pinta
    const paintCanvas = document.createElement("canvas");
    let painted = false;
    const resetPaint = () => {
      const src = baseImg;
      paintCanvas.width = src?.width ?? 1024;
      paintCanvas.height = src?.height ?? 1024;
      const g = paintCanvas.getContext("2d")!;
      if (src) g.drawImage(src, 0, 0);
      else { g.fillStyle = "#9aa7b4"; g.fillRect(0, 0, paintCanvas.width, paintCanvas.height); }
      painted = !!src;
    };
    let tex: THREE.CanvasTexture | null = null;
    let time = 0;
    let absolute = false; // a animação guarda posições do modelo (e não em relação ao pai)

    const load = (url: string | null) => new Promise<HTMLImageElement | null>((res) => {
      if (!url) return res(null);
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => res(null);
      im.src = url;
    });

    // textura = cor do jogo com o ajuste (filtro CSS do canvas) + cor do time onde o _Team marca
    const setLook = (quick = false) => {
      if (!mesh) return;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      if (!baseImg && !painted) { mat.map = null; mat.color.set(0x9aa7b4); mat.needsUpdate = true; return; }
      const { tint, teamColor } = live.current;
      canvas.width = paintCanvas.width;
      canvas.height = paintCanvas.height;
      const g = canvas.getContext("2d")!;
      g.filter = `hue-rotate(${tint.hue}deg) saturate(${100 + tint.sat}%) brightness(${100 + tint.bright}%)`;
      g.drawImage(paintCanvas, 0, 0);
      g.filter = "none";
      if (teamImg && !quick) {
        // tinge onde o alfa do _Team indica
        const t = document.createElement("canvas");
        t.width = canvas.width; t.height = canvas.height;
        const tg = t.getContext("2d")!;
        tg.drawImage(teamImg, 0, 0, t.width, t.height);
        const td = tg.getImageData(0, 0, t.width, t.height);
        const cd = g.getImageData(0, 0, canvas.width, canvas.height);
        const c = new THREE.Color(teamColor);
        const tr = c.r * 255, tgc = c.g * 255, tb = c.b * 255;
        for (let i = 0; i < cd.data.length; i += 4) {
          const a = Math.max(td.data[i + 3], td.data[i]) / 255 * 0.85;
          if (a <= 0.01) continue;
          const lum = (cd.data[i] * 0.3 + cd.data[i + 1] * 0.59 + cd.data[i + 2] * 0.11) / 255;
          cd.data[i] = cd.data[i] * (1 - a) + tr * lum * 1.5 * a;
          cd.data[i + 1] = cd.data[i + 1] * (1 - a) + tgc * lum * 1.5 * a;
          cd.data[i + 2] = cd.data[i + 2] * (1 - a) + tb * lum * 1.5 * a;
        }
        g.putImageData(cd, 0, 0);
      }
      if (!tex) {
        tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.flipY = false;
        tex.anisotropy = 4;
      }
      tex.needsUpdate = true;
      mat.map = tex;
      mat.color.set(0xffffff);
      mat.needsUpdate = true;
    };

    const setModel = async () => {
      if (mesh) { holder.remove(mesh); mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose(); mesh = null; }
      bones = [];
      const m = live.current.model;
      if (!m || !m.positions.length) return;
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(m.positions, 3));
      if (m.normals.some((n) => n !== 0)) g.setAttribute("normal", new THREE.Float32BufferAttribute(m.normals, 3)); else g.computeVertexNormals();
      g.setAttribute("uv", new THREE.Float32BufferAttribute(m.uvs, 2));
      g.setIndex(m.indices);
      const n = m.positions.length / 3;
      const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) { si[i * 4] = Math.min(m.boneIndex[i] ?? 0, Math.max(0, m.bones.length - 1)); sw[i * 4] = 1; }
      g.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(si, 4));
      g.setAttribute("skinWeight", new THREE.Float32BufferAttribute(sw, 4));
      const bl = m.bones.length ? m.bones : [{ name: "Root", parent: -1, pos: [0, 0, 0] as [number, number, number], rot: [1, 0, 0, 0] as [number, number, number, number] }];
      bones = bl.map((b) => { const x = new THREE.Bone(); x.name = b.name; x.position.set(...b.pos); x.quaternion.copy(q4(b.rot)); return x; });
      rest = bones.map((b) => ({ p: b.position.clone(), q: b.quaternion.clone() }));
      const roots: THREE.Bone[] = [];
      bl.forEach((b, i) => { if (b.parent >= 0 && b.parent < bones.length && b.parent !== i) bones[b.parent].add(bones[i]); else roots.push(bones[i]); });
      const sm = new THREE.SkinnedMesh(g, new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.35, side: THREE.DoubleSide }));
      roots.forEach((r) => sm.add(r));
      sm.updateMatrixWorld(true);
      sm.bind(new THREE.Skeleton(bones));
      mesh = sm;
      // tamanho padronizado na plataforma
      g.computeBoundingBox();
      const bb = g.boundingBox!;
      const size = bb.getSize(new THREE.Vector3());
      const k = 1.5 / Math.max(size.x, size.z, size.y * 0.8, 1e-3);
      holder.scale.setScalar(k);
      holder.position.set(-((bb.min.x + bb.max.x) / 2) * k, -bb.min.y * k, -((bb.min.z + bb.max.z) / 2) * k);
      holder.add(sm);
      camera.position.set(2.3, 1.6, 2.6);
      orbit.target.set(0, 0.45, 0);
      orbit.update();
      [baseImg, teamImg] = await Promise.all([load(live.current.albedoOverride ?? m.albedo), load(m.team)]);
      resetPaint();
      setLook();
      setAnim();
    };

    const setAnim = () => {
      time = 0;
      const a = live.current.anim;
      bones.forEach((b, i) => { b.position.copy(rest[i].p); b.quaternion.copy(rest[i].q); });
      if (!a || !a.frames.length) return;
      // a animação guarda posições em relação ao pai ou do modelo? escolhe a que bate com o repouso
      let errRel = 0, errAbs = 0, cnt = 0;
      const world = bones.map((b) => b.getWorldPosition(new THREE.Vector3()).applyMatrix4(holder.matrixWorld.clone().invert()));
      a.bones.forEach((name, j) => {
        const i = bones.findIndex((b) => b.name.toLowerCase() === name.toLowerCase());
        if (i < 0) return;
        const p = new THREE.Vector3(...a.frames[0].positions[j]);
        errRel += p.distanceTo(rest[i].p);
        errAbs += p.distanceTo(world[i]);
        cnt++;
      });
      absolute = cnt > 0 && errAbs < errRel * 0.5;
    };

    const applyFrame = (t: number) => {
      const a = live.current.anim;
      if (!a || !a.frames.length || !bones.length) return;
      const dur = Math.max(0.001, a.duration || a.frames[a.frames.length - 1].time || 1);
      const tt = t % dur;
      let k = a.frames.findIndex((f) => f.time > tt);
      if (k <= 0) k = k === 0 ? 1 : a.frames.length - 1;
      const f0 = a.frames[Math.max(0, k - 1)], f1 = a.frames[Math.min(a.frames.length - 1, k)];
      const u = f1.time > f0.time ? (tt - f0.time) / (f1.time - f0.time) : 0;
      const qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), pa = new THREE.Vector3(), pb = new THREE.Vector3();
      a.bones.forEach((name, j) => {
        const i = bones.findIndex((b) => b.name.toLowerCase() === name.toLowerCase());
        if (i < 0) return;
        pa.set(...f0.positions[j]); pb.set(...f1.positions[j]);
        qa.copy(q4(f0.rotations[j])); qb.copy(q4(f1.rotations[j]));
        const b = bones[i];
        b.position.copy(pa.lerp(pb, u));
        b.quaternion.copy(qa.slerp(qb, u));
        if (absolute && b.parent instanceof THREE.Bone) {
          // converte de posição do modelo para posição em relação ao pai
          const pm = new THREE.Matrix4().compose(b.parent.position, b.parent.quaternion, new THREE.Vector3(1, 1, 1));
          const m = new THREE.Matrix4().compose(b.position, b.quaternion, new THREE.Vector3(1, 1, 1));
          m.premultiply(pm.invert()).decompose(b.position, b.quaternion, new THREE.Vector3());
        }
      });
    };

    // ---- pincel: pinta na textura onde o raio acerta o modelo
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    let painting = false;
    let lastDab = 0;
    const dab = (e: PointerEvent) => {
      const pt = live.current.paint;
      if (!mesh || !pt) return;
      const r = renderer.domElement.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const hit = ray.intersectObject(mesh, false)[0];
      if (!hit?.uv) return;
      const W = paintCanvas.width, H = paintCanvas.height;
      const x = ((hit.uv.x % 1) + 1) % 1 * W, y = ((hit.uv.y % 1) + 1) % 1 * H;
      const rad = Math.max(1, (pt.size / 100) * W * 0.25);
      const g = paintCanvas.getContext("2d")!;
      const grad = g.createRadialGradient(x, y, 0, x, y, rad);
      const c = new THREE.Color(pt.color);
      const rgb = `${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)}`;
      grad.addColorStop(0, `rgba(${rgb},${pt.opacity})`);
      grad.addColorStop(0.7, `rgba(${rgb},${pt.opacity * 0.6})`);
      grad.addColorStop(1, `rgba(${rgb},0)`);
      g.fillStyle = grad;
      g.beginPath();
      g.arc(x, y, rad, 0, Math.PI * 2);
      g.fill();
      painted = true;
      setLook(true);
    };
    const onDown = (e: PointerEvent) => {
      if (!live.current.paint?.on || e.button !== 0) return;
      painting = true;
      orbit.enabled = false;
      renderer.domElement.setPointerCapture(e.pointerId);
      dab(e);
    };
    const onMove = (e: PointerEvent) => {
      if (!painting) return;
      const now = performance.now();
      if (now - lastDab < 24) return;
      lastDab = now;
      dab(e);
    };
    const onUp = () => {
      if (!painting) return;
      painting = false;
      orbit.enabled = true;
      setLook();
      live.current.onPainted?.(paintCanvas.toDataURL("image/png"));
    };
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointermove", onMove);
    renderer.domElement.addEventListener("pointerup", onUp);

    let raf = 0;
    let last = performance.now();
    let lastReport = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (document.hidden || el.offsetParent === null) return;
      if (live.current.playing && live.current.anim) {
        time += dt * live.current.speed;
        applyFrame(time);
        if (now - lastReport > 100) { live.current.onTime?.(time); lastReport = now; }
      } else if (live.current.anim && typeof live.current.seek === "number") {
        time = live.current.seek;
        applyFrame(time);
      }
      orbit.update();
      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(tick);
    const ro = new ResizeObserver(() => {
      camera.aspect = el.clientWidth / Math.max(1, el.clientHeight);
      camera.updateProjectionMatrix();
      renderer.setSize(el.clientWidth, el.clientHeight);
    });
    ro.observe(el);
    if (live.current.snapshotRef) {
      live.current.snapshotRef.current = () => {
        try {
          renderer.render(scene, camera);
          const c = document.createElement("canvas");
          c.width = 480; c.height = 300;
          const g = c.getContext("2d")!;
          const src = renderer.domElement;
          const k = Math.max(480 / src.width, 300 / src.height);
          g.drawImage(src, (480 - src.width * k) / 2, (300 - src.height * k) / 2, src.width * k, src.height * k);
          return c.toDataURL("image/png");
        } catch { return null; }
      };
    }
    if (live.current.iconRef) {
      live.current.iconRef.current = () => {
        try {
          const size = new THREE.Vector2();
          renderer.getSize(size);
          const bg = scene.background, cam = camera.position.clone(), tgt = orbit.target.clone(), aspect = camera.aspect;
          floor.visible = ring.visible = false;
          scene.background = null;
          renderer.setClearColor(0x000000, 0);
          renderer.setSize(256, 256, false);
          camera.aspect = 1;
          camera.position.set(1.9, 1.35, 2.1);
          camera.lookAt(0, 0.4, 0);
          camera.updateProjectionMatrix();
          renderer.render(scene, camera);
          const url = renderer.domElement.toDataURL("image/png");
          floor.visible = ring.visible = true;
          scene.background = bg;
          renderer.setSize(size.x, size.y, false);
          camera.aspect = aspect;
          camera.position.copy(cam);
          orbit.target.copy(tgt);
          camera.updateProjectionMatrix();
          orbit.update();
          return url;
        } catch { return null; }
      };
    }
    api.current = { setModel: () => void setModel(), setLook: () => void (async () => { if (live.current.albedoOverride !== undefined && mesh) { baseImg = await load(live.current.albedoOverride ?? live.current.model?.albedo ?? null); resetPaint(); } setLook(); })(), setAnim };
    void setModel();
    return () => {
      api.current = null;
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointermove", onMove);
      renderer.domElement.removeEventListener("pointerup", onUp);
      orbit.dispose();
      if (mesh) { mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose(); }
      tex?.dispose();
      renderer.dispose();
      el.removeChild(renderer.domElement);
    };
  }, []);

  useEffect(() => { api.current?.setModel(); }, [props.model]);
  useEffect(() => { api.current?.setLook(); }, [props.tint, props.teamColor, props.albedoOverride]);
  useEffect(() => { api.current?.setAnim(); }, [props.anim]);

  return <div ref={host} className={`viewport unit-viewport ${props.paint?.on ? "painting" : ""}`} />;
}
