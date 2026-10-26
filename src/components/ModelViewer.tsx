import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { locale, t } from "../lib/i18n";
import type { MeshView } from "../lib/types";

interface Stage {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  grid: THREE.GridHelper;
  content: THREE.Group;
  boneGroup: THREE.Group;
  wireframe: THREE.LineSegments | null;
  dispose: () => void;
}

/**
 * Visualizador 3D de modelos .scm (malha, esqueleto e grade).
 *
 * O contexto WebGL é criado UMA vez por visualizador e reaproveitado quando o modelo muda: antes,
 * cada modelo novo abria um contexto novo e, navegando pelo catálogo, o navegador passava do limite
 * de contextos e derrubava o do mapa (a vista do editor ficava toda branca).
 */
export default function ModelViewer({ mesh, texture }: { mesh: MeshView; texture?: string | null }) {
  const host = useRef<HTMLDivElement>(null);
  const [wire, setWire] = useState(false);
  const [bones, setBones] = useState(true);
  const stage = useRef<Stage | null>(null);
  const flags = useRef({ wire, bones });
  flags.current = { wire, bones };

  // palco: renderizador, câmera, luz e controles (uma vez)
  useEffect(() => {
    const el = host.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.setSize(el.clientWidth, el.clientHeight);
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, el.clientWidth / Math.max(1, el.clientHeight), 0.01, 1000);
    scene.add(new THREE.HemisphereLight(0xdbe9ff, 0x1a2a38, 1.4));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(3, 5, 4);
    scene.add(sun);
    const content = new THREE.Group();
    const boneGroup = new THREE.Group();
    boneGroup.renderOrder = 10;
    scene.add(content, boneGroup);
    const grid = new THREE.GridHelper(4, 16, 0x2b4a66, 0x1b3247);
    scene.add(grid);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    let raf = 0, visible = true;
    const tick = () => {
      if (visible) {
        controls.update();
        renderer.render(scene, camera);
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    const ro = new ResizeObserver(() => {
      camera.aspect = el.clientWidth / Math.max(1, el.clientHeight);
      camera.updateProjectionMatrix();
      renderer.setSize(el.clientWidth, el.clientHeight);
    });
    ro.observe(el);
    // fora da tela não desenha (economiza a placa de vídeo para o mapa)
    const io = new IntersectionObserver((es) => { visible = es.some((e) => e.isIntersecting); });
    io.observe(el);

    stage.current = {
      scene, camera, controls, grid, content, boneGroup, wireframe: null,
      dispose: () => {
        cancelAnimationFrame(raf);
        ro.disconnect();
        io.disconnect();
        controls.dispose();
        renderer.dispose();
        // devolve o contexto na hora (sem esperar o coletor de lixo do navegador)
        renderer.forceContextLoss();
        renderer.domElement.remove();
      },
    };
    return () => {
      clearContent(stage.current);
      stage.current?.dispose();
      stage.current = null;
    };
  }, []);

  // modelo: troca só o conteúdo do palco
  useEffect(() => {
    const st = stage.current;
    if (!st) return;
    clearContent(st);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(mesh.positions, 3));
    if (mesh.uvs.length) geo.setAttribute("uv", new THREE.Float32BufferAttribute(mesh.uvs, 2));
    geo.setIndex(mesh.indices);
    if (mesh.normals.some((n) => n !== 0)) geo.setAttribute("normal", new THREE.Float32BufferAttribute(mesh.normals, 3));
    else geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: 0x9fb3c6, metalness: 0.25, roughness: 0.6, side: THREE.DoubleSide });
    let alive = true;
    if (texture) {
      new THREE.TextureLoader().load(texture, (tex) => {
        if (!alive) { tex.dispose(); return; }
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.flipY = false;
        mat.map = tex;
        mat.color.set(0xffffff);
        mat.needsUpdate = true;
      });
    }
    st.content.add(new THREE.Mesh(geo, mat));
    const wireframe = new THREE.LineSegments(new THREE.WireframeGeometry(geo), new THREE.LineBasicMaterial({ color: 0xf2b33d, transparent: true, opacity: 0.55 }));
    wireframe.visible = flags.current.wire;
    st.content.add(wireframe);
    st.wireframe = wireframe;

    const pts: number[] = [];
    mesh.bones.forEach((b) => {
      if (b.parent >= 0 && b.parent < mesh.bones.length) pts.push(...mesh.bones[b.parent].position, ...b.position);
    });
    if (pts.length) {
      const bg = new THREE.BufferGeometry();
      bg.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
      st.boneGroup.add(new THREE.LineSegments(bg, new THREE.LineBasicMaterial({ color: 0x7bd88f, depthTest: false })));
    }
    st.boneGroup.visible = flags.current.bones;

    const size = new THREE.Vector3().subVectors(new THREE.Vector3(...mesh.bboxMax), new THREE.Vector3(...mesh.bboxMin));
    const center = new THREE.Vector3(...mesh.bboxMin).add(size.clone().multiplyScalar(0.5));
    const radius = Math.max(size.length() / 2, 0.1);
    st.grid.scale.setScalar(radius);
    st.grid.position.y = mesh.bboxMin[1];
    st.camera.position.copy(center.clone().add(new THREE.Vector3(radius * 1.8, radius * 1.3, radius * 2.2)));
    st.camera.near = radius / 200;
    st.camera.far = radius * 60;
    st.camera.updateProjectionMatrix();
    st.controls.target.copy(center);
    st.controls.update();
    return () => { alive = false; };
  }, [mesh, texture]);

  useEffect(() => { if (stage.current?.wireframe) stage.current.wireframe.visible = wire; }, [wire]);
  useEffect(() => { if (stage.current) stage.current.boneGroup.visible = bones; }, [bones]);

  return (
    <div style={{ position: "relative" }}>
      <div ref={host} className="model-stage" />
      <div className="row small" style={{ position: "absolute", left: 12, bottom: 10, gap: 14 }}>
        <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={wire} onChange={(e) => setWire(e.target.checked)} /> {t("Malha")}</label>
        <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={bones} onChange={(e) => setBones(e.target.checked)} /> {t("Ossos ({n})", { n: mesh.bones.length })}</label>
        <span className="faint">{t("{n} triângulos, versão {v}", { n: mesh.triangles.toLocaleString(locale()), v: mesh.version })}</span>
      </div>
    </div>
  );
}

/** tira o modelo anterior do palco e libera a memória dele */
function clearContent(st: Stage | null) {
  if (!st) return;
  for (const g of [st.content, st.boneGroup]) {
    for (const o of [...g.children]) {
      g.remove(o);
      o.traverse((c) => {
        const m = c as THREE.Mesh;
        m.geometry?.dispose();
        const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
        for (const mt of mats) { (mt as THREE.MeshStandardMaterial).map?.dispose(); mt.dispose(); }
      });
    }
  }
  st.wireframe = null;
}
