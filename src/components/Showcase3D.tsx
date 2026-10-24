import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import type { MeshView } from "../lib/types";

export interface ShowcaseModel {
  mesh: MeshView;
  albedo?: string | null;
  /** `_Team` do jogo: o alfa marca onde entra a cor do time. */
  team?: string | null;
  /** `_Mask` do jogo: o verde marca as partes que brilham. */
  mask?: string | null;
  /** Cor do time (#rrggbb). */
  teamColor?: string;
}

const LIME = 0xa3e635;
const CYAN = 0x38bdf8;

/** Textura de chapas metálicas desenhada em canvas (para o robô de reserva). */
function panelTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  g.fillStyle = "#b9c3cf";
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 900; i++) {
    const v = 80 + Math.random() * 40;
    g.fillStyle = `rgba(${v},${v + 6},${v + 14},0.18)`;
    g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  g.strokeStyle = "rgba(20,24,30,0.75)";
  g.lineWidth = 2;
  for (const [x, y, w, h] of [[8, 8, 112, 72], [128, 8, 120, 120], [8, 88, 112, 160], [128, 136, 120, 112]]) g.strokeRect(x, y, w, h);
  g.fillStyle = "rgba(20,24,30,0.8)";
  for (let i = 0; i < 24; i++) g.fillRect(16 + (i % 6) * 40, 20 + Math.floor(i / 6) * 64, 3, 3);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Robô original (não é de nenhum jogo): aparece quando os modelos do jogo não estão disponíveis. */
function buildMech(): THREE.Group {
  const tex = panelTexture();
  const armor = new THREE.MeshStandardMaterial({ map: tex, color: 0xc9d3de, metalness: 0.55, roughness: 0.38 });
  const frame = new THREE.MeshStandardMaterial({ color: 0x2b3038, metalness: 0.7, roughness: 0.45 });
  const accent = new THREE.MeshStandardMaterial({ color: 0x4a5a2a, metalness: 0.4, roughness: 0.5 });
  const glow = new THREE.MeshStandardMaterial({ color: LIME, emissive: LIME, emissiveIntensity: 2.2 });
  const g = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, ry, rz);
    g.add(mesh);
    return mesh;
  };
  const rb = (w: number, h: number, d: number, r = 0.06) => new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2, h / 2, d / 2));
  const cyl = (rt: number, rbm: number, h: number, seg = 24) => new THREE.CylinderGeometry(rt, rbm, h, seg);
  for (const s of [-1, 1]) {
    // pernas
    add(rb(0.46, 0.2, 0.86, 0.06), frame, s * 0.42, 0.1, 0.1);
    add(rb(0.38, 0.12, 0.3, 0.04), armor, s * 0.42, 0.24, 0.36);
    add(rb(0.32, 0.8, 0.36, 0.08), armor, s * 0.42, 0.62, 0.02, 0.1);
    add(cyl(0.06, 0.06, 0.62), frame, s * 0.42, 0.62, -0.22, 0.1);
    add(cyl(0.17, 0.17, 0.42), frame, s * 0.42, 1.04, 0.02, 0, 0, Math.PI / 2);
    add(cyl(0.06, 0.06, 0.44), glow, s * 0.42, 1.04, 0.02, 0, 0, Math.PI / 2).scale.set(1, 1.02, 1);
    add(rb(0.36, 0.62, 0.44, 0.08), armor, s * 0.4, 1.38, -0.04, -0.14);
    // ombros e braços
    add(rb(0.62, 0.42, 0.74, 0.12), armor, s * 0.95, 2.42, 0, 0, 0, s * -0.16);
    add(rb(0.5, 0.06, 0.6, 0.02), accent, s * 0.97, 2.66, 0, 0, 0, s * -0.16);
    add(rb(0.1, 0.05, 0.52, 0.02), glow, s * 1.2, 2.5, 0, 0, 0, s * -0.16);
    add(cyl(0.13, 0.13, 0.5), frame, s * 0.92, 2.05, 0.02);
    add(rb(0.3, 0.52, 0.34, 0.07), armor, s * 0.94, 1.7, 0.1, -0.35);
    // canhões
    add(rb(0.34, 0.3, 0.7, 0.06), frame, s * 0.94, 1.46, 0.42);
    add(cyl(0.07, 0.07, 0.6, 16), armor, s * 0.94 + 0.08, 1.5, 0.95, Math.PI / 2);
    add(cyl(0.07, 0.07, 0.6, 16), armor, s * 0.94 - 0.08, 1.5, 0.95, Math.PI / 2);
    add(cyl(0.045, 0.045, 0.04, 12), glow, s * 0.94 + 0.08, 1.5, 1.26, Math.PI / 2);
    add(cyl(0.045, 0.045, 0.04, 12), glow, s * 0.94 - 0.08, 1.5, 1.26, Math.PI / 2);
  }
  // quadril e tronco
  add(rb(0.98, 0.34, 0.62, 0.08), frame, 0, 1.72, -0.02);
  add(rb(0.5, 0.26, 0.5, 0.06), armor, 0, 1.62, 0.12);
  add(rb(1.3, 0.86, 0.92, 0.16), armor, 0, 2.28, 0);
  add(rb(1.0, 0.5, 0.1, 0.04), frame, 0, 2.3, 0.46);
  for (let i = 0; i < 3; i++) add(rb(0.7, 0.05, 0.04, 0.01), glow, 0, 2.18 + i * 0.1, 0.52);
  add(rb(0.92, 0.12, 0.96, 0.04), accent, 0, 2.73, 0);
  // mochila com reatores
  add(rb(0.9, 0.78, 0.46, 0.1), frame, 0, 2.28, -0.64);
  for (const x of [-0.26, 0.26]) {
    add(cyl(0.13, 0.16, 0.4), armor, x, 1.92, -0.78);
    add(cyl(0.1, 0.1, 0.02), glow, x, 1.71, -0.78);
    add(cyl(0.03, 0.03, 0.62, 8), frame, x * 1.2, 3.0, -0.7);
  }
  // cabeça
  add(rb(0.5, 0.36, 0.52, 0.1), armor, 0, 2.92, 0.08);
  add(rb(0.42, 0.08, 0.06, 0.03), glow, 0, 2.94, 0.35);
  add(rb(0.24, 0.12, 0.2, 0.04), frame, 0, 3.14, -0.02);
  return g;
}

/** Disco da plataforma com brilho radial e anéis (textura em canvas). */
function platformTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(256, 256, 0, 256, 256, 256);
  grad.addColorStop(0, "rgba(163,230,53,0.28)");
  grad.addColorStop(0.45, "rgba(163,230,53,0.08)");
  grad.addColorStop(1, "rgba(163,230,53,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 512, 512);
  g.strokeStyle = "rgba(163,230,53,0.35)";
  for (const [r, w] of [[120, 1], [170, 1], [236, 2]]) {
    g.lineWidth = w;
    g.beginPath();
    g.arc(256, 256, r, 0, Math.PI * 2);
    g.stroke();
  }
  g.strokeStyle = "rgba(163,230,53,0.5)";
  g.lineWidth = 3;
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    g.beginPath();
    g.moveTo(256 + Math.cos(a) * 222, 256 + Math.sin(a) * 222);
    g.lineTo(256 + Math.cos(a) * (i % 6 === 0 ? 200 : 214), 256 + Math.sin(a) * (i % 6 === 0 ? 200 : 214));
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function loadTex(url?: string | null): Promise<THREE.Texture | null> {
  if (!url) return Promise.resolve(null);
  return new Promise((ok) => new THREE.TextureLoader().load(url, (t) => {
    t.flipY = false;
    t.anisotropy = 4;
    ok(t);
  }, undefined, () => ok(null)));
}

/**
 * Material do modelo como no jogo: textura base cinza, cor do time onde a máscara `_Team` manda
 * e brilho próprio nas luzes (`_Mask`, canal verde).
 */
function unitMaterial(albedo: THREE.Texture | null, team: THREE.Texture | null, mask: THREE.Texture | null, color: string) {
  if (albedo) albedo.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshStandardMaterial({ map: albedo, color: albedo ? 0xffffff : 0xaab6c4, metalness: 0.35, roughness: 0.55 });
  const teamColor = { value: new THREE.Color(color) };
  mat.userData.teamColor = teamColor;
  if (!albedo || (!team && !mask)) return mat;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.teamMap = { value: team };
    sh.uniforms.glowMap = { value: mask };
    sh.uniforms.teamColor = teamColor;
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <map_pars_fragment>", `#include <map_pars_fragment>
        uniform sampler2D teamMap; uniform sampler2D glowMap; uniform vec3 teamColor;`)
      .replace("#include <map_fragment>", `#include <map_fragment>
        ${team ? `float teamAmt = texture2D(teamMap, vMapUv).a;
        vec3 tinted = teamColor * (0.25 + diffuseColor.rgb * 1.6);
        diffuseColor.rgb = mix(diffuseColor.rgb, tinted, teamAmt);` : ""}`)
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
        ${mask ? `float glowAmt = texture2D(glowMap, vMapUv).g;
        totalEmissiveRadiance += mix(vec3(1.0), teamColor, 0.55) * glowAmt * 1.6;` : ""}`);
  };
  mat.customProgramCacheKey = () => `unit-${!!team}-${!!mask}`;
  return mat;
}

async function meshFromView(view: MeshView, m: ShowcaseModel): Promise<THREE.Mesh> {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(view.positions, 3));
  if (view.uvs.length) geo.setAttribute("uv", new THREE.Float32BufferAttribute(view.uvs, 2));
  geo.setIndex(view.indices);
  if (view.normals.some((n) => n !== 0)) geo.setAttribute("normal", new THREE.Float32BufferAttribute(view.normals, 3));
  else geo.computeVertexNormals();
  const [albedo, team, mask] = await Promise.all([loadTex(m.albedo), loadTex(m.team), loadTex(m.mask)]);
  return new THREE.Mesh(geo, unitMaterial(albedo, team, mask, m.teamColor ?? "#3c78d8"));
}

/**
 * Vitrine 3D da tela inicial: o modelo gira devagar sobre uma plataforma luminosa; arraste para girar.
 * `model` nulo mostra o robô de reserva.
 */
export default function Showcase3D({ model, paused, teamColor }: { model: ShowcaseModel | null; paused?: boolean; teamColor?: string }) {
  const materialRef = useRef<THREE.MeshStandardMaterial | null>(null);
  const colorRef = useRef(teamColor);
  colorRef.current = teamColor;
  // trocar a cor do time não remonta a cena: só muda o uniform do shader
  useEffect(() => {
    const u = materialRef.current?.userData.teamColor as { value: THREE.Color } | undefined;
    if (u && teamColor) u.value.set(teamColor);
  }, [teamColor]);
  const host = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useEffect(() => {
    const el = host.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
    } catch {
      return; // sem WebGL: a tela inicial continua funcionando sem a vitrine
    }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.setSize(el.clientWidth, el.clientHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, el.clientWidth / Math.max(1, el.clientHeight), 0.05, 200);

    // modelo normalizado: ~3 unidades de altura, centrado e apoiado no chão
    const holder = new THREE.Group();
    let disposed = false;
    const place = (obj: THREE.Object3D) => {
      const box = new THREE.Box3().setFromObject(obj);
      const size = box.getSize(new THREE.Vector3());
      const scale = 3 / Math.max(size.y, size.x * 0.8, size.z * 0.8, 1e-3);
      obj.scale.setScalar(scale);
      const center = box.getCenter(new THREE.Vector3());
      obj.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);
      holder.add(obj);
    };
    if (model) {
      // texturas carregam antes de montar o material (o shader da cor do time precisa delas)
      void meshFromView(model.mesh, model).then((mesh) => {
        if (disposed) { mesh.geometry.dispose(); return; }
        materialRef.current = mesh.material as THREE.MeshStandardMaterial;
        const u = materialRef.current.userData.teamColor as { value: THREE.Color } | undefined;
        if (u && colorRef.current) u.value.set(colorRef.current);
        place(mesh);
      });
    } else place(buildMech());
    scene.add(holder);

    // plataforma: disco com brilho + anel pulsante + sombra
    const disc = new THREE.Mesh(new THREE.CircleGeometry(2.6, 64), new THREE.MeshBasicMaterial({ map: platformTexture(), transparent: true, depthWrite: false }));
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.005;
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(1.4, 48),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.002;
    const ring = new THREE.Mesh(new THREE.RingGeometry(2.25, 2.3, 96), new THREE.MeshBasicMaterial({ color: LIME, transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.01;
    scene.add(shadow, disc, ring);

    // partículas subindo devagar
    const N = 140;
    const pos = new Float32Array(N * 3);
    const speed = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = Math.random() * Math.PI * 2, r = 0.8 + Math.random() * 2.6;
      pos.set([Math.cos(a) * r, Math.random() * 4, Math.sin(a) * r], i * 3);
      speed[i] = 0.12 + Math.random() * 0.3;
    }
    const pgeo = new THREE.BufferGeometry();
    pgeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const points = new THREE.Points(pgeo, new THREE.PointsMaterial({ color: LIME, size: 0.035, transparent: true, opacity: 0.7, depthWrite: false }));
    scene.add(points);

    // luzes: ambiente, principal, preenchimento frio e contorno verde
    scene.add(new THREE.HemisphereLight(0xdbe9ff, 0x0d1117, 1.1));
    const key = new THREE.DirectionalLight(0xfff4e6, 2.4);
    key.position.set(4, 6, 5);
    const fill = new THREE.DirectionalLight(model ? 0xbfd6ff : CYAN, model ? 0.6 : 0.8);
    fill.position.set(-5, 2, 3);
    // modelo do jogo: luz mais neutra para a cor do time aparecer como no jogo
    const rim = new THREE.DirectionalLight(model ? 0xdfe9ff : LIME, model ? 1.4 : 2.6);
    rim.position.set(-2, 4, -6);
    const under = new THREE.PointLight(LIME, model ? 1.2 : 6, 6, 2);
    under.position.set(0, 0.3, 0);
    scene.add(key, fill, rim, under);

    camera.position.set(7.4, 3.6, 9.8);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 1.55, 0);
    controls.enableZoom = false;
    controls.enablePan = false;
    controls.enableDamping = true;
    controls.minPolarAngle = Math.PI * 0.28;
    controls.maxPolarAngle = Math.PI * 0.49;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    controls.autoRotate = !reduced;
    controls.autoRotateSpeed = 1.1;
    controls.update();

    // entrada suave
    holder.scale.setScalar(0.85);
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (document.hidden) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      controls.autoRotate = !reduced && !pausedRef.current;
      holder.scale.setScalar(holder.scale.x + (1 - holder.scale.x) * Math.min(1, dt * 4));
      const t = now / 1000;
      (ring.material as THREE.MeshBasicMaterial).opacity = 0.45 + Math.sin(t * 2) * 0.25;
      under.intensity = (model ? 1.1 : 5) + Math.sin(t * 2) * (model ? 0.3 : 1.5);
      if (!reduced) {
        for (let i = 0; i < N; i++) {
          pos[i * 3 + 1] += speed[i] * dt;
          if (pos[i * 3 + 1] > 4.2) pos[i * 3 + 1] = 0;
        }
        pgeo.attributes.position.needsUpdate = true;
      }
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
    return () => {
      disposed = true;
      materialRef.current = null;
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.Points) {
          o.geometry.dispose();
          const m = o.material as THREE.Material & { map?: THREE.Texture | null };
          m.map?.dispose();
          m.dispose();
        }
      });
      renderer.dispose();
      el.removeChild(renderer.domElement);
    };
  }, [model]);

  return <div ref={host} className="showcase-canvas" aria-hidden="true" />;
}
