// Renderiza ícones de tropas a partir do modelo 3D: câmera, luz, fundo, contorno e símbolo de função.
// O enquadramento é automático (recorta pela silhueta), então ícones de tropas diferentes ficam
// do mesmo tamanho e consistentes entre si.
import * as THREE from "three";
import type { ViewModel } from "./UnitViewport";

export type IconBg = "transparent" | "solid" | "gradient" | "tactical";
export type IconSymbol = "none" | "land" | "air" | "naval" | "artillery" | "antiair" | "engineer" | "experimental" | "structure" | "shield";
export interface IconSpec {
  yaw: number; pitch: number; fill: number; fov: number;
  light: number; ambient: number; rim: string; rimPower: number;
  bg: IconBg; bgColor: string; bgColor2: string; frame: boolean;
  outline: number; outlineColor: string;
  symbol: IconSymbol; symbolColor: string; corner: "tl" | "tr" | "bl" | "br";
  teamColor: string; sharpen: number;
}
export const ICON_SIZES = [24, 32, 48, 64, 128, 256, 512];
export const SYMBOL_LABEL: Record<IconSymbol, string> = { none: "Nenhum", land: "Terrestre", air: "Aérea", naval: "Naval", artillery: "Artilharia", antiair: "Antiaérea", engineer: "Engenheiro", experimental: "Experimental", structure: "Estrutura", shield: "Escudo" };
export const BG_LABEL: Record<IconBg, string> = { transparent: "Transparente", solid: "Cor lisa", gradient: "Degradê", tactical: "Painel tático" };

export function defaultIconSpec(): IconSpec {
  return {
    yaw: 35, pitch: 28, fill: 0.84, fov: 30, light: 1, ambient: 0.9, rim: "#9cc3ff", rimPower: 0.9,
    bg: "tactical", bgColor: "#16202b", bgColor2: "#2b3f55", frame: true, outline: 2, outlineColor: "#05080b",
    symbol: "none", symbolColor: "#ffd166", corner: "br", teamColor: "#2f6fd6", sharpen: 0.5,
  };
}
export const ICON_PRESETS: { id: string; label: string; spec: Partial<IconSpec> }[] = [
  { id: "tactical", label: "Painel tático", spec: { bg: "tactical", frame: true, bgColor: "#16202b", bgColor2: "#2b3f55", outline: 2 } },
  { id: "clean", label: "Transparente", spec: { bg: "transparent", frame: false, outline: 2 } },
  { id: "dark", label: "Escuro", spec: { bg: "gradient", bgColor: "#0b0e12", bgColor2: "#26303a", frame: false, outline: 1 } },
  { id: "light", label: "Claro", spec: { bg: "gradient", bgColor: "#c9d2da", bgColor2: "#eef2f5", frame: false, outline: 2, outlineColor: "#1b232b" } },
  { id: "side", label: "De lado", spec: { yaw: 90, pitch: 8 } },
  { id: "top", label: "De cima", spec: { yaw: 20, pitch: 70 } },
];

/** Tingimento do _Team e ajuste de cor, igual à prévia 3D. */
export function composeAlbedo(base: HTMLImageElement | null, team: HTMLImageElement | null, teamColor: string, tint = { hue: 0, sat: 0, bright: 0 }): HTMLCanvasElement | null {
  if (!base) return null;
  const c = document.createElement("canvas");
  c.width = base.width; c.height = base.height;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.filter = `hue-rotate(${tint.hue}deg) saturate(${100 + tint.sat}%) brightness(${100 + tint.bright}%)`;
  g.drawImage(base, 0, 0);
  g.filter = "none";
  if (team) {
    const t = document.createElement("canvas");
    t.width = c.width; t.height = c.height;
    const tg = t.getContext("2d", { willReadFrequently: true })!;
    tg.drawImage(team, 0, 0, t.width, t.height);
    const td = tg.getImageData(0, 0, t.width, t.height), cd = g.getImageData(0, 0, c.width, c.height);
    const col = new THREE.Color(teamColor);
    for (let i = 0; i < cd.data.length; i += 4) {
      const a = (Math.max(td.data[i + 3], td.data[i]) / 255) * 0.85;
      if (a <= 0.01) continue;
      const lum = (cd.data[i] * 0.3 + cd.data[i + 1] * 0.59 + cd.data[i + 2] * 0.11) / 255;
      cd.data[i] = cd.data[i] * (1 - a) + col.r * 255 * lum * 1.5 * a;
      cd.data[i + 1] = cd.data[i + 1] * (1 - a) + col.g * 255 * lum * 1.5 * a;
      cd.data[i + 2] = cd.data[i + 2] * (1 - a) + col.b * 255 * lum * 1.5 * a;
    }
    g.putImageData(cd, 0, 0);
  }
  return c;
}

export const loadImg = (url: string | null) => new Promise<HTMLImageElement | null>((res) => {
  if (!url) return res(null);
  const im = new Image();
  im.onload = () => res(im);
  im.onerror = () => res(null);
  im.src = url;
});

let renderer: THREE.WebGLRenderer | null = null;
const R = 768;

/** Foto da tropa com fundo transparente (R×R), com luz e câmera do ícone. */
async function shoot(model: ViewModel, albedo: string | null, spec: IconSpec, tint?: { hue: number; sat: number; bright: number }): Promise<HTMLCanvasElement> {
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(R, R, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
  }
  const scene = new THREE.Scene();
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(model.positions, 3));
  if (model.normals.some((n) => n !== 0)) g.setAttribute("normal", new THREE.Float32BufferAttribute(model.normals, 3)); else g.computeVertexNormals();
  g.setAttribute("uv", new THREE.Float32BufferAttribute(model.uvs, 2));
  g.setIndex(Array.from(model.indices));
  const [base, team] = await Promise.all([loadImg(albedo ?? model.albedo), loadImg(model.team)]);
  const look = composeAlbedo(base, team, spec.teamColor, tint);
  let tex: THREE.CanvasTexture | null = null;
  if (look) { tex = new THREE.CanvasTexture(look); tex.colorSpace = THREE.SRGBColorSpace; tex.flipY = model.flipY; tex.anisotropy = 4; }
  const mat = new THREE.MeshStandardMaterial({ map: tex, color: tex ? 0xffffff : 0x9aa7b4, roughness: 0.55, metalness: 0.3, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(g, mat);
  g.computeBoundingBox();
  const bb = g.boundingBox!, c = bb.getCenter(new THREE.Vector3()), size = bb.getSize(new THREE.Vector3());
  mesh.position.sub(c);
  scene.add(mesh);
  scene.add(new THREE.HemisphereLight(0xe6eeff, 0x20262e, 1.1 * spec.ambient));
  const key = new THREE.DirectionalLight(0xfff2de, 2.8 * spec.light);
  const rim = new THREE.DirectionalLight(new THREE.Color(spec.rim), 2.2 * spec.rimPower);
  const rad = Math.max(size.x, size.y, size.z) || 1;
  const cam = new THREE.PerspectiveCamera(spec.fov, 1, rad * 0.01, rad * 50);
  const yaw = (spec.yaw * Math.PI) / 180, pitch = (spec.pitch * Math.PI) / 180;
  const dist = (rad * 1.2) / Math.tan(((spec.fov * Math.PI) / 180) / 2);
  cam.position.set(Math.sin(yaw) * Math.cos(pitch) * dist, Math.sin(pitch) * dist, Math.cos(yaw) * Math.cos(pitch) * dist);
  cam.lookAt(0, 0, 0);
  key.position.set(Math.sin(yaw + 0.8) * dist, dist * 1.2, Math.cos(yaw + 0.8) * dist);
  rim.position.set(-Math.sin(yaw) * dist, dist * 0.4, -Math.cos(yaw) * dist);
  scene.add(key, rim);
  renderer.setClearColor(0x000000, 0);
  renderer.render(scene, cam);
  const out = document.createElement("canvas");
  out.width = out.height = R;
  out.getContext("2d")!.drawImage(renderer.domElement, 0, 0);
  g.dispose(); mat.dispose(); tex?.dispose();
  return out;
}

function alphaBox(c: HTMLCanvasElement) {
  const d = c.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, c.width, c.height).data;
  let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3] > 16) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

function symbolPath(g: CanvasRenderingContext2D, s: IconSymbol, cx: number, cy: number, r: number) {
  g.beginPath();
  const P = (pts: [number, number][]) => { pts.forEach(([x, y], i) => (i ? g.lineTo(cx + x * r, cy + y * r) : g.moveTo(cx + x * r, cy + y * r))); g.closePath(); };
  switch (s) {
    case "land": P([[-0.75, -0.2], [0.75, -0.2], [0.6, 0.45], [-0.6, 0.45]]); g.moveTo(cx - 0.25 * r, cy - 0.2 * r); g.rect(cx - 0.3 * r, cy - 0.6 * r, 0.6 * r, 0.4 * r); break;
    case "air": P([[0, -0.8], [0.8, 0.55], [0, 0.25], [-0.8, 0.55]]); break;
    case "naval": P([[-0.85, -0.05], [0.85, -0.05], [0.5, 0.55], [-0.5, 0.55]]); g.rect(cx - 0.2 * r, cy - 0.55 * r, 0.4 * r, 0.5 * r); break;
    case "artillery": g.arc(cx, cy, 0.7 * r, 0, Math.PI * 2); g.moveTo(cx + 0.3 * r, cy); g.arc(cx, cy, 0.3 * r, 0, Math.PI * 2, true); break;
    case "antiair": P([[0, -0.85], [0.7, 0.1], [0.25, 0.1], [0.25, 0.7], [-0.25, 0.7], [-0.25, 0.1], [-0.7, 0.1]]); break;
    case "engineer": for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; const x = Math.cos(a) * 0.75, y = Math.sin(a) * 0.75; if (k) g.lineTo(cx + x * r, cy + y * r); else g.moveTo(cx + x * r, cy + y * r); } g.closePath(); g.moveTo(cx + 0.28 * r, cy); g.arc(cx, cy, 0.28 * r, 0, Math.PI * 2, true); break;
    case "experimental": for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + (k / 10) * Math.PI * 2; const rr = k % 2 ? 0.38 : 0.85; const x = Math.cos(a) * rr, y = Math.sin(a) * rr; if (k) g.lineTo(cx + x * r, cy + y * r); else g.moveTo(cx + x * r, cy + y * r); } g.closePath(); break;
    case "structure": g.rect(cx - 0.65 * r, cy - 0.65 * r, 1.3 * r, 1.3 * r); g.rect(cx - 0.3 * r, cy + 0.3 * r, 0.6 * r, -0.6 * r); break;
    case "shield": P([[0, -0.8], [0.7, -0.5], [0.6, 0.25], [0, 0.85], [-0.6, 0.25], [-0.7, -0.5]]); break;
    default: break;
  }
}

export interface IconResult { url: string; checks: { level: "ok" | "warn"; text: string }[] }

/** Gera o ícone `size`×`size` (PNG em data URL) e as verificações de legibilidade. */
export async function renderIcon(model: ViewModel, spec: IconSpec, size: number, albedo: string | null = null, tint?: { hue: number; sat: number; bright: number }): Promise<IconResult> {
  const shot = await shoot(model, albedo, spec, tint);
  const box = alphaBox(shot);
  const S = Math.max(16, Math.min(1024, Math.round(size)));
  const W = S * 2; // desenha em dobro e reduz (bordas mais limpas)
  const out = document.createElement("canvas");
  out.width = out.height = W;
  const g = out.getContext("2d", { willReadFrequently: true })!;
  const frameW = spec.frame && spec.bg !== "transparent" ? Math.max(2, W * 0.035) : 0;
  // fundo
  if (spec.bg !== "transparent") {
    if (spec.bg === "solid") { g.fillStyle = spec.bgColor; g.fillRect(0, 0, W, W); }
    else {
      const gr = g.createLinearGradient(0, 0, spec.bg === "tactical" ? W * 0.3 : 0, W);
      gr.addColorStop(0, spec.bgColor2); gr.addColorStop(1, spec.bgColor);
      g.fillStyle = gr; g.fillRect(0, 0, W, W);
      if (spec.bg === "tactical") {
        // grade discreta e brilho no centro
        g.strokeStyle = "rgba(255,255,255,0.05)"; g.lineWidth = Math.max(1, W / 256);
        const step = W / 8;
        for (let k = 1; k < 8; k++) { g.beginPath(); g.moveTo(k * step, 0); g.lineTo(k * step, W); g.moveTo(0, k * step); g.lineTo(W, k * step); g.stroke(); }
        const rg = g.createRadialGradient(W / 2, W * 0.55, 0, W / 2, W * 0.55, W * 0.6);
        rg.addColorStop(0, "rgba(255,255,255,0.10)"); rg.addColorStop(1, "rgba(0,0,0,0.25)");
        g.fillStyle = rg; g.fillRect(0, 0, W, W);
      }
    }
  }
  // tropa recortada pela silhueta, centralizada
  let cover = 0;
  if (box) {
    const avail = (W - frameW * 2) * spec.fill;
    const k = avail / Math.max(box.w, box.h);
    const dw = box.w * k, dh = box.h * k, dx = (W - dw) / 2, dy = (W - dh) / 2;
    if (spec.outline > 0) {
      // contorno: silhueta pintada deslocada em 16 direções
      const sil = document.createElement("canvas");
      sil.width = sil.height = W;
      const sg = sil.getContext("2d")!;
      sg.drawImage(shot, box.x, box.y, box.w, box.h, dx, dy, dw, dh);
      sg.globalCompositeOperation = "source-in";
      sg.fillStyle = spec.outlineColor; sg.fillRect(0, 0, W, W);
      const o = spec.outline * (W / 128);
      for (let a = 0; a < 16; a++) g.drawImage(sil, Math.cos((a / 16) * Math.PI * 2) * o, Math.sin((a / 16) * Math.PI * 2) * o);
    }
    g.drawImage(shot, box.x, box.y, box.w, box.h, dx, dy, dw, dh);
    cover = (dw * dh) / (W * W);
  }
  if (frameW) {
    // moldura chanfrada (cantos cortados)
    const c = W * 0.12;
    g.save();
    g.lineWidth = frameW; g.strokeStyle = spec.bgColor2;
    g.beginPath(); g.moveTo(c, frameW / 2); g.lineTo(W - frameW / 2, frameW / 2); g.lineTo(W - frameW / 2, W - c); g.lineTo(W - c, W - frameW / 2); g.lineTo(frameW / 2, W - frameW / 2); g.lineTo(frameW / 2, c); g.closePath(); g.stroke();
    g.lineWidth = Math.max(1, frameW / 3); g.strokeStyle = "rgba(255,255,255,0.35)"; g.stroke();
    g.restore();
    // limpa os cantos cortados
    g.save(); g.globalCompositeOperation = "destination-out";
    g.beginPath(); g.moveTo(0, 0); g.lineTo(c - frameW / 2, 0); g.lineTo(0, c - frameW / 2); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(W, W); g.lineTo(W - c + frameW / 2, W); g.lineTo(W, W - c + frameW / 2); g.closePath(); g.fill();
    g.restore();
  }
  if (spec.symbol !== "none") {
    const r = W * 0.13, m = W * 0.06 + frameW + r;
    const cx = spec.corner.endsWith("r") ? W - m : m, cy = spec.corner.startsWith("b") ? W - m : m;
    g.save();
    g.beginPath(); g.arc(cx, cy, r * 1.25, 0, Math.PI * 2); g.fillStyle = "rgba(5,8,11,0.78)"; g.fill();
    g.lineWidth = Math.max(1, W / 160); g.strokeStyle = spec.symbolColor; g.stroke();
    symbolPath(g, spec.symbol, cx, cy, r * 0.85);
    g.fillStyle = spec.symbolColor; g.fill("evenodd");
    g.restore();
  }
  // reduz para o tamanho final e realça em tamanhos pequenos
  const fin = document.createElement("canvas");
  fin.width = fin.height = S;
  const fg = fin.getContext("2d", { willReadFrequently: true })!;
  fg.imageSmoothingQuality = "high";
  fg.drawImage(out, 0, 0, S, S);
  const amt = spec.sharpen * (S <= 64 ? 1 : S <= 128 ? 0.5 : 0.2);
  if (amt > 0.01) sharpen(fg, S, amt);
  // verificações de legibilidade
  const checks: IconResult["checks"] = [];
  if (!box) checks.push({ level: "warn", text: "Nada apareceu na foto: confira se o modelo carregou." });
  else {
    if (cover < 0.18) checks.push({ level: "warn", text: "A tropa ocupa pouco do ícone: aumente o preenchimento ou mude o ângulo." });
    const ct = silhouetteContrast(fg, S);
    if (ct !== null && ct < 0.12 && spec.outline < 1) checks.push({ level: "warn", text: "Pouco contraste entre a tropa e o fundo: ligue o contorno ou troque o fundo." });
    if (S <= 32 && spec.symbol !== "none") checks.push({ level: "ok", text: "Em 32 px ou menos, o símbolo ajuda mais que o modelo a reconhecer a função." });
    checks.push({ level: "ok", text: `Tropa ocupa ${Math.round(cover * 100)}% do ícone${ct !== null ? `, contraste ${Math.round(ct * 100)}%` : ""}.` });
  }
  return { url: fin.toDataURL("image/png"), checks };
}

function sharpen(g: CanvasRenderingContext2D, S: number, amt: number) {
  const im = g.getImageData(0, 0, S, S), d = im.data, src = new Uint8ClampedArray(d);
  for (let y = 1; y < S - 1; y++) for (let x = 1; x < S - 1; x++) {
    const i = (y * S + x) * 4;
    for (let c = 0; c < 3; c++) {
      const blur = (src[i - 4 + c] + src[i + 4 + c] + src[i - S * 4 + c] + src[i + S * 4 + c]) / 4;
      d[i + c] = src[i + c] + (src[i + c] - blur) * amt;
    }
  }
  g.putImageData(im, 0, 0);
}

/** diferença de luminância entre o miolo e a borda do ícone (aprox. tropa × fundo) */
function silhouetteContrast(g: CanvasRenderingContext2D, S: number): number | null {
  const d = g.getImageData(0, 0, S, S).data;
  let a = 0, na = 0, b = 0, nb = 0;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4;
    if (d[i + 3] < 128) continue;
    const l = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
    const center = Math.abs(x - S / 2) < S * 0.18 && Math.abs(y - S / 2) < S * 0.18;
    const edge = x < S * 0.08 || y < S * 0.08 || x > S * 0.92 || y > S * 0.92;
    if (center) { a += l; na++; } else if (edge) { b += l; nb++; }
  }
  return na && nb ? Math.abs(a / na - b / nb) : null;
}
