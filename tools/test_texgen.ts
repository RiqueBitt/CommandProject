// Teste do gerador de texturas: determinismo, camadas independentes, quinas detectadas e
// resultado com variação (não uma cor chapada). Grava PNGs em TEXGEN_OUT (opcional) para olhar.
// node --experimental-strip-types tools/test_texgen.ts
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { bakeSurface, defaultTexSpec, generateTexture, TEX_PRESETS, texChecks, type TexModel } from "../src/pages/create/texgen.ts";

/** caixa com quinas vivas (24 vértices) e UV em cruz; mais uma caixa menor em cima (torre) */
function boxes(): TexModel {
  const P: number[] = [], N: number[] = [], U: number[] = [], I: number[] = [];
  const box = (c: number[], h: number[], u0: number, v0: number, us: number) => {
    const faces = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    faces.forEach((n, f) => {
      const b = P.length / 3;
      const [a1, a2] = n[0] ? [[0, 1, 0], [0, 0, 1]] : n[1] ? [[1, 0, 0], [0, 0, 1]] : [[1, 0, 0], [0, 1, 0]];
      const cu = u0 + (f % 3) * us, cv = v0 + Math.floor(f / 3) * us;
      for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        for (let k = 0; k < 3; k++) P.push(c[k] + (n[k] + a1[k] * su + a2[k] * sv) * h[k]);
        N.push(...n);
        U.push(cu + ((su + 1) / 2) * us * 0.94 + us * 0.03, cv + ((sv + 1) / 2) * us * 0.94 + us * 0.03);
      }
      I.push(b, b + 1, b + 2, b, b + 2, b + 3);
    });
  };
  box([0, 0.3, 0], [0.6, 0.3, 1], 0, 0, 0.32);
  box([0, 0.8, -0.1], [0.35, 0.2, 0.45], 0, 0.66, 0.11);
  return { positions: P, normals: N, uvs: U, indices: I };
}

let fails = 0;
const check = (c: boolean, m: string) => { if (!c) { fails++; console.log("FALHOU:", m); } };
const m = boxes();
const S = 256;
const t0 = Date.now();
const sf = bakeSurface(m, S);
check(sf.coverage > 0.3, `cobertura ${sf.coverage}`);
check(sf.hardEdges >= 24, `quinas: ${sf.hardEdges}`);
let near = 0;
for (let i = 0; i < S * S; i++) if (sf.mask[i] === 1 && sf.convex[i] < 2) near++;
check(near > 200, `texels perto de quinas: ${near}`);

// original: cinza com ruído
const orig = new Uint8ClampedArray(S * S * 4);
for (let i = 0; i < S * S; i++) { const v = 120 + ((i * 2654435761) >>> 28); orig[i * 4] = v; orig[i * 4 + 1] = v; orig[i * 4 + 2] = v; orig[i * 4 + 3] = 200; }

const spec = defaultTexSpec(7);
const a = generateTexture(sf, spec, orig), b = generateTexture(sf, spec, orig);
check(a.rgba.every((v, i) => v === b.rgba[i]), "determinístico");
check(a.rgba.every((v) => Number.isFinite(v)), "sem NaN");
check(a.rgba[3] === 200, "mantém o alfa original");

for (const p of TEX_PRESETS) {
  const s = p.apply(spec);
  const r = generateTexture(sf, s, orig);
  check(r.stats.contrast > 0.02, `${p.id}: contraste ${r.stats.contrast.toFixed(3)}`);
  const c = texChecks(sf, r);
  console.log(p.id.padEnd(8), "contraste", r.stats.contrast.toFixed(3), "gasto", r.stats.worn.toFixed(2), "sujo", r.stats.dirty.toFixed(2), c.filter((x) => x.level === "warn").map((x) => x.text).join(" | "));
  if (process.env.TEXGEN_OUT) writeFileSync(`${process.env.TEXGEN_OUT}/tex-${p.id}.png`, png(r.rgba, S));
}

// trocar a semente do desgaste não mexe na camuflagem
const camo = { ...spec, view: "camo" as const, base: { ...spec.base, pattern: "woodland" as const } };
const c1 = generateTexture(sf, camo, orig), c2 = generateTexture(sf, { ...camo, wear: { ...camo.wear, seed: 999 } }, orig);
check(c1.rgba.every((v, i) => v === c2.rgba[i]), "camadas independentes (semente do desgaste)");
const w1 = generateTexture(sf, { ...spec, view: "wear" }, orig), w2 = generateTexture(sf, { ...spec, view: "wear", wear: { ...spec.wear, seed: 999 } }, orig);
check(w1.rgba.some((v, i) => v !== w2.rgba[i]), "nova semente muda o desgaste");
// sem original também funciona
const n = generateTexture(sf, TEX_PRESETS[1].apply(spec), null);
check(n.rgba[3] === 255 && n.stats.contrast > 0.02, "sem textura original");

console.log(`${Date.now() - t0} ms`);
if (fails) { console.log(`${fails} falha(s)`); process.exit(1); }
console.log("texgen ok");

function png(rgba: Uint8ClampedArray, s: number): Buffer {
  const raw = Buffer.alloc((s * 4 + 1) * s);
  for (let y = 0; y < s; y++) { raw[y * (s * 4 + 1)] = 0; Buffer.from(rgba.buffer, y * s * 4, s * 4).copy(raw, y * (s * 4 + 1) + 1); }
  const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc = (b: Buffer) => { let c = -1; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (t: string, d: Buffer) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(s, 0); ih.writeUInt32BE(s, 4); ih[8] = 8; ih[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ih), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
