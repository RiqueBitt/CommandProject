// Texturas de chão importadas pelo usuário (.png, .jpg, .webp, .bmp).
//
// A imagem vira um quadrado (recorte central, lado em potência de 2 até 1024), pode ficar contínua
// (sem emenda quando se repete no chão) e é guardada como PNG nos arquivos do projeto. Ao gerar o
// mapa, o app transforma o PNG nas três texturas do jogo (_d cor, _n relevo, _s brilho) em
// /textures/terrain/cp/<slug>_*.dds dentro do pacote do mapa.
import { api } from "../../lib/api";
import type { LayerSet } from "../../lib/types";
import type { CustomTex } from "../create/docs";

export const CUSTOM_DIR = "/textures/terrain/cp/";
export const customStem = (t: CustomTex) => `${CUSTOM_DIR}${t.slug}`;
export const isCustomPath = (p: string | null | undefined) => !!p && p.toLowerCase().startsWith(CUSTOM_DIR);

/** As importadas como camadas (para escolher num papel do bioma, igual às do jogo). */
export function customLayers(list: CustomTex[] | undefined): LayerSet[] {
  return (list ?? []).map((t) => ({ map: "Importada", name: t.name, d: `${customStem(t)}_d.dds`, n: `${customStem(t)}_n.dds`, s: `${customStem(t)}_s.dds`, slotD: 0, slotN: 0, slotS: 0 }));
}

// caminho da difusa → imagem (data URL) do projeto
const urls = new Map<string, Promise<string | null>>();
export function registerCustomTextures(creation: string, list: CustomTex[] | undefined) {
  for (const t of list ?? []) {
    const k = `${customStem(t)}_d.dds`.toLowerCase();
    if (!urls.has(k)) urls.set(k, api.creationAsset(creation, t.asset).then((u) => u.replace(/^data:[^;,]*/, "data:image/png")).catch(() => null));
  }
}

/** Miniatura/textura: as importadas vêm do projeto, as outras dos arquivos do jogo. */
export function texUrl(path: string, max = 128): Promise<string | null> {
  const hit = urls.get(path.toLowerCase());
  if (hit) return hit;
  if (isCustomPath(path)) return Promise.resolve(null);
  return api.gameTexture(path, max);
}

// ------------------------------------------------------------------ preparar a imagem

const pow2Below = (n: number) => 2 ** Math.floor(Math.log2(Math.max(1, n)));

/** Mistura a imagem com ela mesma deslocada meio quadro, só perto das bordas: a emenda some. */
function makeSeamless(px: Uint8ClampedArray, n: number) {
  const band = 0.22;
  const wt = (i: number) => {
    const d = Math.min(i, n - 1 - i) / n / band;
    const t = Math.min(1, d);
    return t * t * (3 - 2 * t);
  };
  const pass = (src: Uint8ClampedArray, horizontal: boolean) => {
    const out = new Uint8ClampedArray(src.length);
    const h = n >> 1;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const w = wt(horizontal ? x : y);
      const sx = horizontal ? (x + h) % n : x, sy = horizontal ? y : (y + h) % n;
      const o = (y * n + x) * 4, so = (sy * n + sx) * 4;
      for (let c = 0; c < 3; c++) out[o + c] = src[o + c] * w + src[so + c] * (1 - w);
      out[o + 3] = 255;
    }
    return out;
  };
  return pass(pass(px, true), false);
}

export interface PreparedTexture { png: string; side: number; preview: string }

/** Lê o arquivo e devolve o PNG quadrado pronto (base64, sem o prefixo data:). */
export async function prepareTexture(file: Blob, opts: { seamless: boolean; max?: number }): Promise<PreparedTexture> {
  const bmp = await createImageBitmap(file);
  const short = Math.min(bmp.width, bmp.height);
  if (short < 64) throw new Error("imagem pequena demais (mínimo 64 × 64)");
  const side = Math.min(opts.max ?? 1024, pow2Below(short));
  const cv = document.createElement("canvas");
  cv.width = cv.height = side;
  const g = cv.getContext("2d", { willReadFrequently: true });
  if (!g) throw new Error("não deu para preparar a imagem");
  g.imageSmoothingQuality = "high";
  g.drawImage(bmp, (bmp.width - short) / 2, (bmp.height - short) / 2, short, short, 0, 0, side, side);
  bmp.close?.();
  if (opts.seamless) {
    const id = g.getImageData(0, 0, side, side);
    id.data.set(makeSeamless(id.data, side));
    g.putImageData(id, 0, 0);
  }
  const url = cv.toDataURL("image/png");
  return { png: url.slice(url.indexOf(",") + 1), side, preview: url };
}

/** Guarda no projeto e devolve a entrada para `doc.customTex`. */
export async function importTexture(creation: string, file: File, seamless: boolean): Promise<CustomTex> {
  const prep = await prepareTexture(file, { seamless });
  const base = file.name.replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 40) || "textura";
  const asset = await api.creationAssetPut(creation, `chao_${base}.png`, prep.png);
  // o nome do arquivo guardado leva um resumo do conteúdo: a mesma imagem dá o mesmo caminho no jogo
  const hash = (asset.match(/-([0-9a-f]{6,})\.png$/i)?.[1] ?? Math.random().toString(16).slice(2, 12)).toLowerCase();
  const t: CustomTex = { slug: `u_${hash.slice(0, 10)}`, name: base.replace(/_/g, " "), asset };
  urls.set(`${customStem(t)}_d.dds`.toLowerCase(), Promise.resolve(prep.preview));
  return t;
}
