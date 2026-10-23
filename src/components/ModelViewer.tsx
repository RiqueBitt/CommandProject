import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { MeshView } from "../lib/types";

/** Visualizador 3D de modelos .scm (malha, esqueleto e grade). */
export default function ModelViewer({ mesh, texture }: { mesh: MeshView; texture?: string | null }) {
  const host = useRef<HTMLDivElement>(null);
  const [wire, setWire] = useState(false);
  const [bones, setBones] = useState(true);
  const api = useRef<{ setWire: (v: boolean) => void; setBones: (v: boolean) => void } | null>(null);

  useEffect(() => {
    const el = host.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.setSize(el.clientWidth, el.clientHeight);
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, el.clientWidth / el.clientHeight, 0.01, 1000);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(mesh.positions, 3));
    if (mesh.uvs.length) geo.setAttribute("uv", new THREE.Float32BufferAttribute(mesh.uvs, 2));
    geo.setIndex(mesh.indices);
    const hasNormals = mesh.normals.some((n) => n !== 0);
    if (hasNormals) geo.setAttribute("normal", new THREE.Float32BufferAttribute(mesh.normals, 3));
    else geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({ color: 0x9fb3c6, metalness: 0.25, roughness: 0.6, side: THREE.DoubleSide });
    if (texture) {
      new THREE.TextureLoader().load(texture, (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.flipY = false;
        mat.map = tex;
        mat.color.set(0xffffff);
        mat.needsUpdate = true;
      });
    }
    const model = new THREE.Mesh(geo, mat);
    const wireMat = new THREE.LineBasicMaterial({ color: 0xf2b33d, transparent: true, opacity: 0.55 });
    const wireframe = new THREE.LineSegments(new THREE.WireframeGeometry(geo), wireMat);
    wireframe.visible = false;
    scene.add(model, wireframe);

    // esqueleto
    const boneGroup = new THREE.Group();
    const pts: number[] = [];
    mesh.bones.forEach((b) => {
      if (b.parent >= 0 && b.parent < mesh.bones.length) pts.push(...mesh.bones[b.parent].position, ...b.position);
    });
    if (pts.length) {
      const bg = new THREE.BufferGeometry();
      bg.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
      boneGroup.add(new THREE.LineSegments(bg, new THREE.LineBasicMaterial({ color: 0x7bd88f, depthTest: false })));
    }
    boneGroup.renderOrder = 10;
    scene.add(boneGroup);

    const size = new THREE.Vector3().subVectors(new THREE.Vector3(...mesh.bboxMax), new THREE.Vector3(...mesh.bboxMin));
    const center = new THREE.Vector3(...mesh.bboxMin).add(size.clone().multiplyScalar(0.5));
    const radius = Math.max(size.length() / 2, 0.1);
    const grid = new THREE.GridHelper(radius * 4, 16, 0x2b4a66, 0x1b3247);
    grid.position.y = mesh.bboxMin[1];
    scene.add(grid);

    scene.add(new THREE.HemisphereLight(0xdbe9ff, 0x1a2a38, 1.4));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(3, 5, 4);
    scene.add(sun);

    camera.position.copy(center.clone().add(new THREE.Vector3(radius * 1.8, radius * 1.3, radius * 2.2)));
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(center);
    controls.enableDamping = true;
    controls.update();

    api.current = {
      setWire: (v) => { wireframe.visible = v; },
      setBones: (v) => { boneGroup.visible = v; },
    };

    let raf = 0;
    const tick = () => {
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    tick();
    const ro = new ResizeObserver(() => {
      camera.aspect = el.clientWidth / Math.max(1, el.clientHeight);
      camera.updateProjectionMatrix();
      renderer.setSize(el.clientWidth, el.clientHeight);
    });
    ro.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      geo.dispose();
      mat.dispose();
      renderer.dispose();
      el.removeChild(renderer.domElement);
    };
  }, [mesh, texture]);

  useEffect(() => { api.current?.setWire(wire); }, [wire]);
  useEffect(() => { api.current?.setBones(bones); }, [bones]);

  return (
    <div style={{ position: "relative" }}>
      <div ref={host} className="model-stage" />
      <div className="row small" style={{ position: "absolute", left: 12, bottom: 10, gap: 14 }}>
        <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={wire} onChange={(e) => setWire(e.target.checked)} /> Malha</label>
        <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={bones} onChange={(e) => setBones(e.target.checked)} /> Ossos ({mesh.bones.length})</label>
        <span className="faint">{mesh.triangles.toLocaleString("pt-BR")} triângulos, versão {mesh.version}</span>
      </div>
    </div>
  );
}
