// Roda o gerador de texturas fora da tela principal (a interface não trava enquanto gera).
import { bakeSurface, generateTexture, texChecks, type Surface, type TexModel, type TexSpec } from "./texgen";

let cache: { key: string; surf: Surface } | null = null;

self.onmessage = (e: MessageEvent<{ id: number; key: string; model: TexModel | null; size: number; spec: TexSpec; orig: Uint8ClampedArray | null }>) => {
  const { id, key, model, size, spec, orig } = e.data;
  try {
    if (!cache || cache.key !== `${key}@${size}`) {
      if (!model) { (self as unknown as Worker).postMessage({ id, need: true }); return; }
      cache = { key: `${key}@${size}`, surf: bakeSurface(model, size) };
    }
    const r = generateTexture(cache.surf, spec, orig);
    (self as unknown as Worker).postMessage({ id, rgba: r.rgba, checks: texChecks(cache.surf, r) }, [r.rgba.buffer]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: String(err) });
  }
};
