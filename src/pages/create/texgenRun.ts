// Ponte entre a interface e o Worker do gerador de texturas.
import type { TexModel, TexSpec } from "./texgen";

export interface TexRun { url: string; checks: { level: "ok" | "warn"; text: string }[]; size: number }

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (v: { rgba?: Uint8ClampedArray; checks?: TexRun["checks"]; need?: boolean; error?: string }) => void }>();
const origCache = new Map<string, Uint8ClampedArray | null>();

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL("./texgen.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (e) => { const p = pending.get(e.data.id); if (p) { pending.delete(e.data.id); p.resolve(e.data); } };
  return worker;
}

/** Tamanho da textura original (para gerar no mesmo tamanho). */
export async function imageSize(url: string | null): Promise<number> {
  if (!url) return 1024;
  const img = await loadImage(url);
  return Math.min(2048, Math.max(256, 2 ** Math.round(Math.log2(Math.max(img.width, img.height)))));
}

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("imagem inválida")); i.src = url; });
}

async function origPixels(url: string | null, size: number): Promise<Uint8ClampedArray | null> {
  if (!url) return null;
  const k = `${size}:${url.length}:${url.slice(-64)}`;
  if (origCache.has(k)) return origCache.get(k)!.slice();
  const img = await loadImage(url);
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(img, 0, 0, size, size);
  const px = g.getImageData(0, 0, size, size).data;
  if (origCache.size > 6) origCache.clear();
  origCache.set(k, px);
  return px.slice();
}

export function toDataUrl(rgba: Uint8ClampedArray, size: number) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  c.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(rgba), size, size), 0, 0);
  return c.toDataURL("image/png");
}

/** Gera a textura. `key` identifica o modelo (a malha só é enviada quando muda). */
export async function runTexgen(key: string, model: TexModel, origUrl: string | null, size: number, spec: TexSpec): Promise<TexRun> {
  const w = getWorker();
  const orig = await origPixels(origUrl, size);
  const send = (withModel: boolean) => new Promise<{ rgba?: Uint8ClampedArray; checks?: TexRun["checks"]; need?: boolean; error?: string }>((resolve) => {
    const id = ++seq;
    pending.set(id, { resolve });
    w.postMessage({ id, key, model: withModel ? { positions: Float32Array.from(model.positions), normals: Float32Array.from(model.normals), uvs: Float32Array.from(model.uvs), indices: Uint32Array.from(model.indices) } : null, size, spec, orig: orig ? orig.slice() : null });
  });
  let r = await send(false);
  if (r.need) r = await send(true);
  if (r.error || !r.rgba) throw new Error(r.error ?? "falha ao gerar a textura");
  return { url: toDataUrl(r.rgba, size), checks: r.checks ?? [], size };
}
