// Ferramentas novas do editor de mapas (puras, testadas em tools/test_maptools.ts):
// mapa por descrição, esboço → relevo, relevo de imagem, carimbos de terreno, régua com tempo de
// viagem e equilíbrio automático das bases.
import type { Pt } from "../studio/mapEdit";
import { distAt, fbm, ridged, rainErode, simplex, walkDistances, walkMask, type Grid, type WorldGen } from "./worldgen.ts";

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (e0: number, e1: number, x: number) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

// ------------------------------------------------------------------ mapa por descrição

const NUM_WORDS: Record<string, number> = {
  um: 1, uma: 1, one: 1, dois: 2, duas: 2, two: 2, tres: 3, three: 3, quatro: 4, four: 4, cinco: 5, five: 5, seis: 6, six: 6,
  sete: 7, seven: 7, oito: 8, eight: 8, nove: 9, nine: 9, dez: 10, ten: 10, doze: 12, twelve: 12, dezesseis: 16, sixteen: 16,
  vinte: 20, twenty: 20, "vinte e quatro": 24, "trinta e dois": 32,
};

export interface Described { over: Partial<WorldGen>; understood: string[] }

/** Lê uma frase em português ou inglês ("arquipélago com 6 jogadores, rios e muitas florestas")
 *  e devolve os ajustes do gerador e o que foi entendido. Sem internet: palavras-chave. */
export function describeWorld(text: string): Described {
  const s = " " + text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w\s]/g, " ").replace(/\s+/g, " ") + " ";
  const has = (...w: string[]) => w.some((x) => s.includes(" " + x));
  const over: Partial<WorldGen> = {};
  const got: string[] = [];
  // quantidade: "muito/muitos/many/lots" > "pouco/few" > normal
  const amount = (keys: string[], base: number, more: number, less: number) => {
    for (const k of keys) {
      const i = s.indexOf(" " + k);
      if (i < 0) continue;
      const before = s.slice(Math.max(0, i - 24), i);
      if (/(sem|nenhum|nenhuma|no|without)\s*$/.test(before)) return 0;
      if (/(muit[oa]s?|bastante|varios|varias|many|lots of|lot of|cheio de|cheia de|tons of)\s*$/.test(before)) return more;
      if (/(pouc[oa]s?|algum|alguns|algumas|few|a few|some)\s*$/.test(before)) return less;
      return base;
    }
    return null;
  };
  // jogadores: "6 jogadores", "3v3", "4 contra 4", "2 vs 2", "ffa 8"
  let players: number | null = null;
  let m = /(\d+)\s*(?:v|vs|x|contra|versus)\s*(\d+)/.exec(s);
  if (m) { players = Number(m[1]) + Number(m[2]); }
  m = players ? null : /(\d+)\s*(?:jogadores|jogador|players|player|bases|pessoas|exercitos)/.exec(s);
  if (m) players = Number(m[1]);
  if (!players) for (const [w, n] of Object.entries(NUM_WORDS)) if (s.includes(` ${w} jogadores`) || s.includes(` ${w} players`)) players = n;
  if (players) { over.players = Math.max(2, Math.min(32, players)); got.push(`${over.players} jogadores`); }
  if (has("todos contra todos", "free for all", "ffa", "cada um por si")) { over.symmetry = "none"; got.push("todos contra todos"); }
  // estilo
  if (has("plataforma", "abismo", "platform", "chasm", "shiva")) { over.style = "platforms"; got.push("plataformas sobre um abismo"); }
  else if (has("continente", "continent", "pangeia")) { Object.assign(over, { style: "ocean", islandMode: "continent", edge: "water" }); got.push("continente no meio do mar"); }
  else if (has("arquipelago", "archipelago", "muitas ilhas", "many islands")) { Object.assign(over, { style: "ocean", islandMode: "scattered", extraIslands: 12, edge: "water" }); got.push("arquipélago"); }
  else if (has("ilha", "ilhas", "island", "islands", "mar aberto", "oceano", "ocean", "mar gigante", "naval")) {
    Object.assign(over, { style: "ocean", islandMode: has("por time", "per team", "cada time", "each team") ? "teams" : "bases", edge: "water" });
    got.push(over.islandMode === "teams" ? "uma ilha por time" : "cada base na sua ilha");
  }
  if (over.style === "ocean") {
    if (has("ponte", "pontes", "bridge", "bridges")) { over.links = "bridges"; got.push("ilhas ligadas por pontes"); }
    else if (has("banco de areia", "bancos de areia", "raso", "rasos", "sandbar", "shallow")) { over.links = "shallows"; got.push("bancos de areia"); }
    else if (has("so pelo mar", "naval", "sem ligacao", "isoladas")) { over.links = "none"; got.push("só pelo mar"); }
    if (has("ilhas grandes", "big islands", "large islands")) { over.islandSize = 1.35; got.push("ilhas grandes"); }
    if (has("ilhas pequenas", "small islands", "ilhotas")) { over.islandSize = 0.7; got.push("ilhas pequenas"); }
    if (has("mar gigante", "oceano gigante", "huge sea", "huge ocean", "mar enorme")) { over.islandSize = Math.min(over.islandSize ?? 1, 0.75); got.push("mar gigante"); }
  }
  // bioma
  if (has("deserto", "desert", "areia", "dunas", "sand")) { over.biome = "desert"; over.dunes = 4; got.push("deserto"); }
  else if (has("neve", "gelo", "snow", "ice", "inverno", "winter", "artico", "arctic")) { over.biome = "snow"; got.push("neve"); }
  else if (has("vulcan", "lava", "volcan", "cinzas", "ash")) { over.biome = "volcanic"; got.push("vulcânico"); }
  else if (has("verde", "floresta tropical", "temperado", "grama", "green", "temperate")) { over.biome = "temperate"; got.push("temperado"); }
  // relevo
  const mt = amount(["montanha", "montanhas", "mountain", "serra", "serras"], 4, 8, 2);
  if (mt !== null) { over.mountains = mt; if (mt >= 8) over.mountainHeight = 70; got.push(mt ? `${mt >= 8 ? "muitas " : mt <= 2 ? "poucas " : ""}montanhas` : "sem montanhas"); }
  if (has("plano", "plana", "flat", "planicie", "campo aberto", "open field")) { Object.assign(over, { mountains: 0, ridges: 0, hills: 1, hilliness: 3 }); got.push("terreno plano"); }
  if (has("montanhoso", "acidentado", "mountainous", "rugged")) { Object.assign(over, { hilliness: 14, mountains: Math.max(over.mountains ?? 0, 6), ridges: 3 }); got.push("relevo acidentado"); }
  // estilo competitivo (como os mapas feitos à mão): platôs em degraus, moldura e massa solta
  if (has("degrau", "degraus", "terraco", "terracos", "patamar", "patamares", "niveis", "terrace", "terraces", "competitivo", "competitive")) { Object.assign(over, { terraces: 0.9, terraceStep: 14, smooth: 0.6 }); got.push("platôs em degraus"); }
  if (has("moldura", "emoldurad", "arena", "framed", "frame")) { over.edge = "frame"; got.push("área de jogo cercada por um abismo"); }
  if (has("massa espalhada", "massa solta", "massas soltas", "scattered mass", "competitivo", "competitive")) { over.massLayout = "scattered"; got.push("massa espalhada pelo mapa"); }
  const lk = amount(["lago", "lagos", "lake", "lakes"], 3, 7, 1);
  if (lk !== null) { over.lakes = lk; got.push(lk ? `${lk >= 7 ? "muitos " : ""}lagos` : "sem lagos"); }
  const rv = amount(["rio", "rios", "river", "rivers"], 2, 5, 1);
  if (rv !== null) { over.rivers = rv; got.push(rv ? `${rv >= 5 ? "muitos " : ""}rios` : "sem rios"); }
  const cr = amount(["cratera", "crateras", "crater", "craters"], 3, 7, 1);
  if (cr !== null) { over.craters = cr; got.push("crateras"); }
  const cn = amount(["canion", "canions", "canyon", "canyons", "desfiladeiro"], 2, 4, 1);
  if (cn !== null) { over.canyons = cn; got.push("cânions"); }
  const fo = amount(["floresta", "florestas", "mata", "matas", "arvores", "forest", "forests", "trees", "bosque"], 0.6, 0.95, 0.25);
  if (fo !== null) { over.forests = fo; got.push(fo ? `${fo >= 0.9 ? "muitas " : fo <= 0.3 ? "poucas " : ""}florestas` : "sem florestas"); }
  const vi = amount(["vila", "vilas", "cidade", "cidades", "village", "villages", "town", "towns"], 3, 6, 1);
  if (vi !== null) { over.settlements = vi; got.push(vi ? "vilas" : "sem vilas"); }
  const ru = amount(["ruina", "ruinas", "destrocos", "wreck", "wrecks", "ruins"], 0.5, 0.9, 0.2);
  if (ru !== null) { over.wrecks = ru; got.push("ruínas e destroços"); }
  if (has("estrada", "estradas", "road", "roads")) { over.roads = true; got.push("estradas"); }
  if (has("gargalo", "gargalos", "choke", "chokepoint", "passagens estreitas")) { over.obstacles = 4; got.push("gargalos"); }
  // jogo
  if (has("rico", "rica", "muita massa", "rich", "lots of mass")) { over.economy = "rich"; got.push("economia rica"); }
  else if (has("pobre", "pouca massa", "poor", "little mass")) { over.economy = "poor"; got.push("economia pobre"); }
  if (has("centro disputado", "centro", "center", "middle")) { over.center = true; got.push("centro disputado"); }
  if (has("base segura", "bases seguras", "safe base", "protegid")) { over.expansions = 3; got.push("bases protegidas"); }
  if (has("muralha", "muralhas", "paredao", "wall", "walls")) { over.teamWalls = true; got.push("cordilheira entre os times"); }
  return { over, understood: got };
}

// ------------------------------------------------------------------ esboço → relevo

/** Cores do esboço (o índice é o que vai na grade do desenho). */
export const SKETCH_KINDS = [
  { id: "plain", label: "Planície", color: "#7bbf6a" },
  { id: "water", label: "Água", color: "#3d7fd1" },
  { id: "hills", label: "Morros", color: "#c9b26b" },
  { id: "mountain", label: "Montanha", color: "#8a6a4f" },
  { id: "desert", label: "Deserto (dunas)", color: "#e8d39a" },
  { id: "plateau", label: "Planalto", color: "#b07a5a" },
  { id: "abyss", label: "Abismo", color: "#2a2f3a" },
] as const;
export type SketchKind = (typeof SKETCH_KINDS)[number]["id"];

/** Desenho (N×N, índice de SKETCH_KINDS por célula) → alturas do mapa, com transições suaves,
 *  detalhe natural e erosão. `base` é a altura do chão "planície". */
export function sketchHeights(g: Grid, sketch: Uint8Array, N: number, water: number, hasWater: boolean, seed: number, base: number): Float32Array {
  const s = g.size, w = s + 1;
  const n = simplex(seed), n2 = simplex(seed + 7);
  // alvo de cada tipo e quanto de ruído/forma ele leva
  const sea = hasWater ? water - 14 : base - 22;
  const target = (k: number, x: number, z: number) => {
    switch (SKETCH_KINDS[k]?.id) {
      case "water": return sea + 3 * fbm(n, x / 90, z / 90, 3);
      case "hills": return base + 16 + 14 * fbm(n, x / 70, z / 70, 4);
      case "mountain": return base + 55 + 55 * ridged(n2, x / 120, z / 120, 4);
      case "desert": return base + 5 + 4 * Math.sin(x / 22 + 2.5 * fbm(n, x / 140, z / 140, 3)) + 2 * fbm(n2, x / 30, z / 30, 2);
      case "plateau": return base + 34 + 3 * fbm(n, x / 60, z / 60, 2);
      case "abyss": return Math.max(2, base - 70) + 6 * fbm(n2, x / 50, z / 50, 2);
      default: return base + 3 * fbm(n, x / 110, z / 110, 4);
    }
  };
  const raw = new Float32Array(w * w);
  for (let j = 0; j <= s; j++) for (let i = 0; i <= s; i++) {
    const x = (i / s) * g.grid, z = (j / s) * g.grid;
    // a fronteira entre as cores tremida (nada de linhas retas do pincel)
    const jx = (fbm(n2, x / 60, z / 60, 2)) * 1.6, jz = (fbm(n2, x / 60 + 9, z / 60 - 4, 2)) * 1.6;
    const ci = Math.max(0, Math.min(N - 1, Math.floor((i / s) * N + jx))), cj = Math.max(0, Math.min(N - 1, Math.floor((j / s) * N + jz)));
    raw[j * w + i] = target(sketch[cj * N + ci], x, z);
  }
  // transições: média em caixa algumas vezes (encostas em vez de degraus)
  let H = raw;
  const r = Math.max(1, Math.round(s / 64));
  for (let pass = 0; pass < 3; pass++) {
    const out = new Float32Array(w * w);
    for (let j = 0; j <= s; j++) for (let i = 0; i <= s; i++) {
      let sum = 0, c = 0;
      for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
        const ii = Math.max(0, Math.min(s, i + di)), jj = Math.max(0, Math.min(s, j + dj));
        sum += H[jj * w + ii]; c++;
      }
      out[j * w + i] = sum / c;
    }
    H = out;
  }
  // a montanha recupera os picos depois de suavizar; o abismo, as paredes a pique
  for (let k = 0; k < w * w; k++) {
    const id = SKETCH_KINDS[sketchAt(sketch, N, s, k % w, Math.floor(k / w))]?.id;
    if (id === "mountain") H[k] = lerp(H[k], raw[k], 0.55);
    if (id === "abyss" || id === "plateau") H[k] = lerp(H[k], raw[k], 0.4);
  }
  rainErode(g, H, seed, water, hasWater, Math.round(w * w / 40));
  for (let k = 0; k < w * w; k++) H[k] = Math.max(0, Math.min(511, H[k]));
  return H;
}
const sketchAt = (sk: Uint8Array, N: number, s: number, i: number, j: number) => sk[Math.min(N - 1, Math.floor((j / s) * N)) * N + Math.min(N - 1, Math.floor((i / s) * N))];

// ------------------------------------------------------------------ relevo de imagem

/** Imagem em tons de cinza (N×M, 0..1) → alturas: preto = `low`, branco = `high`. */
export function imageHeights(g: Grid, gray: Float32Array, W: number, Hh: number, low: number, high: number): Float32Array {
  const s = g.size, w = s + 1;
  const out = new Float32Array(w * w);
  for (let j = 0; j <= s; j++) for (let i = 0; i <= s; i++) {
    // amostragem bilinear
    const fx = (i / s) * (W - 1), fz = (j / s) * (Hh - 1);
    const x0 = Math.floor(fx), z0 = Math.floor(fz), x1 = Math.min(W - 1, x0 + 1), z1 = Math.min(Hh - 1, z0 + 1);
    const tx = fx - x0, tz = fz - z0;
    const v = lerp(lerp(gray[z0 * W + x0], gray[z0 * W + x1], tx), lerp(gray[z1 * W + x0], gray[z1 * W + x1], tx), tz);
    out[j * w + i] = Math.max(0, Math.min(511, lerp(low, high, v)));
  }
  return out;
}

// ------------------------------------------------------------------ carimbos de terreno

export interface Stamp { id: string; name: string; /** lado da amostra */ n: number; /** alturas relativas à média da borda (n×n, int16 em décimos, base64) */ data: string; /** raio de onde veio */ r: number; createdAt: string }

function b64(a: Int16Array) {
  let s = "";
  const u = new Uint8Array(a.buffer);
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
  return btoa(s);
}
function unb64(s: string, n: number) {
  const bin = atob(s), u = new Uint8Array(n * 2);
  for (let i = 0; i < u.length && i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return new Int16Array(u.buffer);
}

function sampleH(g: Grid, H: Float32Array, x: number, z: number) {
  const s = g.size, w = s + 1, f = s / g.grid;
  const fx = Math.max(0, Math.min(s, x * f)), fz = Math.max(0, Math.min(s, z * f));
  const i0 = Math.min(s - 1, Math.floor(fx)), j0 = Math.min(s - 1, Math.floor(fz)), tx = fx - i0, tz = fz - j0;
  return lerp(lerp(H[j0 * w + i0], H[j0 * w + i0 + 1], tx), lerp(H[(j0 + 1) * w + i0], H[(j0 + 1) * w + i0 + 1], tx), tz);
}

/** Guarda o relevo de um círculo como carimbo (alturas relativas à borda do círculo). */
export function captureStamp(g: Grid, H: Float32Array, cx: number, cz: number, r: number, name: string, n = 64): Stamp {
  let rim = 0, c = 0;
  for (let a = 0; a < 48; a++) { rim += sampleH(g, H, cx + Math.cos((a / 48) * Math.PI * 2) * r, cz + Math.sin((a / 48) * Math.PI * 2) * r); c++; }
  rim /= c;
  const d = new Int16Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const u = (i / (n - 1)) * 2 - 1, v = (j / (n - 1)) * 2 - 1;
    d[j * n + i] = Math.round((sampleH(g, H, cx + u * r, cz + v * r) - rim) * 10);
  }
  return { id: `st${Date.now().toString(36)}`, name, n, data: b64(d), r: Math.round(r), createdAt: new Date().toISOString() };
}

/** Cola o carimbo na camada do pincel: centro, raio, giro (graus) e espelhado. A forma sobe a
 *  partir da altura do chão onde cai, e some suave na borda. */
export function applyStamp(g: Grid, layer: Float32Array, cur: Float32Array, st: Stamp, cx: number, cz: number, r: number, rot: number, mirror: boolean, strength = 1) {
  const s = g.size, w = s + 1, step = g.grid / s;
  const d = unb64(st.data, st.n * st.n);
  let rim = 0;
  for (let a = 0; a < 48; a++) rim += sampleH(g, cur, cx + Math.cos((a / 48) * Math.PI * 2) * r, cz + Math.sin((a / 48) * Math.PI * 2) * r);
  rim /= 48;
  // a altura do carimbo acompanha o tamanho (um carimbo ampliado fica mais alto)
  const k = (r / Math.max(1, st.r)) * strength;
  const ca = Math.cos((-rot * Math.PI) / 180), sa = Math.sin((-rot * Math.PI) / 180);
  const at = (u: number, v: number) => {
    const fx = ((u + 1) / 2) * (st.n - 1), fz = ((v + 1) / 2) * (st.n - 1);
    const i0 = Math.max(0, Math.min(st.n - 2, Math.floor(fx))), j0 = Math.max(0, Math.min(st.n - 2, Math.floor(fz)));
    const tx = fx - i0, tz = fz - j0;
    return lerp(lerp(d[j0 * st.n + i0], d[j0 * st.n + i0 + 1], tx), lerp(d[(j0 + 1) * st.n + i0], d[(j0 + 1) * st.n + i0 + 1], tx), tz) / 10;
  };
  const i0 = Math.max(0, Math.floor((cx - r) / step)), i1 = Math.min(s, Math.ceil((cx + r) / step));
  const j0 = Math.max(0, Math.floor((cz - r) / step)), j1 = Math.min(s, Math.ceil((cz + r) / step));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    let u = (i * step - cx) / r, v = (j * step - cz) / r;
    const dd = Math.hypot(u, v);
    if (dd >= 1) continue;
    [u, v] = [u * ca - v * sa, u * sa + v * ca];
    if (mirror) u = -u;
    const kk = j * w + i;
    const want = rim + at(u, v) * k;
    const fall = smooth(1, 0.75, dd);
    const dv = (want - cur[kk]) * fall;
    layer[kk] += dv;
    cur[kk] += dv;
  }
}

const STAMPS = "cp-map-stamps";
export function loadStamps(): Stamp[] {
  try { return JSON.parse(localStorage.getItem(STAMPS) ?? "[]") as Stamp[]; } catch { return []; }
}
export function saveStamps(list: Stamp[]) {
  try { localStorage.setItem(STAMPS, JSON.stringify(list.slice(0, 60))); } catch { /* cheio */ }
}

// ------------------------------------------------------------------ régua e tempo de viagem

/** 1024 unidades do jogo = 20 km. */
export const METERS_PER_UNIT = 20000 / 1024;
/** Velocidades típicas do SC2 (unidades do jogo por segundo). */
export const SPEEDS = [
  { id: "light", label: "Tropa leve", speed: 4.2 },
  { id: "tank", label: "Tanque", speed: 3.0 },
  { id: "heavy", label: "Experimental", speed: 1.8 },
  { id: "air", label: "Avião (reto)", speed: 14 },
] as const;

export interface Measure { straight: number; walk: number | null; times: { id: string; label: string; seconds: number | null }[] }

/** Distância em linha reta e a pé (desviando de água, encostas e bloqueios) e quanto tempo leva. */
export function measure(g: Grid, H: Float32Array, water: number, hasWater: boolean, a: Pt, b: Pt, mask?: Uint8Array): Measure {
  const straight = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const m = mask ?? walkMask(g, H, water, hasWater);
  const d = distAt(g, walkDistances(g, m, a), b);
  // a busca anda em cruz (sem diagonal): na média, ~12% a mais que o caminho de verdade
  const walk = d < 0 ? null : Math.max(straight, d * 0.88);
  return {
    straight, walk,
    times: SPEEDS.map((sp) => ({ id: sp.id, label: sp.label, seconds: sp.id === "air" ? straight / sp.speed : walk === null ? null : walk / sp.speed })),
  };
}

export function fmtTime(sec: number | null) {
  if (sec === null) return "—";
  const m = Math.floor(sec / 60), s = Math.round(sec % 60);
  return m ? `${m} min ${s.toString().padStart(2, "0")} s` : `${s} s`;
}
export function fmtDist(u: number) {
  const m = u * METERS_PER_UNIT;
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

// ------------------------------------------------------------------ equilíbrio

export interface BaseBalance {
  index: number; team: number;
  /** distância a pé até as massas mais próximas (média das 4 primeiras) */
  massReach: number;
  /** massas a até 140 a pé */
  massNear: number;
  /** distância a pé até o inimigo mais próximo (-1 = sem caminho) */
  enemy: number;
  /** quantas direções abertas chegam à base (menos = mais protegida) */
  openness: number;
}

export interface Balance { score: number; bases: BaseBalance[]; problems: string[]; suggestions: Pt[] }

/** Compara as bases (massa perto, distância ao inimigo, quão protegidas) e dá uma nota de 0 a 100,
 *  com os problemas e onde pôr massa para igualar. */
export function balanceMap(g: Grid, H: Float32Array, water: number, hasWater: boolean, spawns: Pt[], mass: Pt[], teamOf: (i: number) => number): Balance {
  const mask = walkMask(g, H, water, hasWater);
  const dists = spawns.map((p) => walkDistances(g, mask, p));
  const bases: BaseBalance[] = spawns.map((p, i) => {
    const md = mass.map((q) => distAt(g, dists[i], q)).filter((x) => x >= 0).sort((x, y) => x - y);
    const massReach = md.length ? md.slice(0, 4).reduce((a, x) => a + x, 0) / Math.min(4, md.length) : 9999;
    const massNear = md.filter((x) => x <= 140).length;
    let enemy = -1;
    spawns.forEach((q, k) => { if (teamOf(k) !== teamOf(i)) { const e = distAt(g, dists[i], q); if (e >= 0 && (enemy < 0 || e < enemy)) enemy = e; } });
    // aberturas: em volta da base (raio 110), quantos setores de 30° deixam passar a pé
    let open = 0;
    for (let a = 0; a < 12; a++) {
      const x = p[0] + Math.cos((a / 12) * Math.PI * 2) * 110, z = p[1] + Math.sin((a / 12) * Math.PI * 2) * 110;
      if (x < 0 || z < 0 || x > g.grid || z > g.grid) continue;
      if (distAt(g, dists[i], [x, z]) >= 0) open++;
    }
    return { index: i, team: teamOf(i), massReach, massNear, enemy, openness: open };
  });
  const spread = (vals: number[]) => {
    const v = vals.filter((x) => x >= 0 && x < 9999);
    if (v.length < 2) return 0;
    const mean = v.reduce((a, x) => a + x, 0) / v.length;
    return mean ? (Math.max(...v) - Math.min(...v)) / mean : 0;
  };
  const problems: string[] = [];
  const sMass = spread(bases.map((b) => b.massReach)), sNear = spread(bases.map((b) => b.massNear + 1)), sEnemy = spread(bases.map((b) => b.enemy)), sOpen = spread(bases.map((b) => b.openness + 1));
  if (bases.some((b) => b.enemy < 0) && spawns.length > 1) problems.push("Há base sem caminho a pé até o inimigo (só naval ou aéreo).");
  if (sNear > 0.35) problems.push("A massa perto das bases é desigual.");
  if (sMass > 0.3) problems.push("Algumas bases andam bem mais até a massa.");
  if (sEnemy > 0.25) problems.push("Algumas bases estão bem mais perto do inimigo.");
  if (sOpen > 0.5) problems.push("Algumas bases são bem mais protegidas que outras (menos entradas).");
  const score = Math.round(100 * Math.max(0, 1 - (Math.min(1, sMass) * 0.3 + Math.min(1, sNear) * 0.3 + Math.min(1, sEnemy) * 0.25 + Math.min(1, sOpen) * 0.15)));
  // sugestão: massa nas bases com menos massa perto, no chão plano a ~90 da base
  const want = Math.max(...bases.map((b) => b.massNear));
  const suggestions: Pt[] = [];
  const slopeAt = (x: number, z: number) => Math.abs(sampleH(g, H, x + 6, z) - sampleH(g, H, x - 6, z)) + Math.abs(sampleH(g, H, x, z + 6) - sampleH(g, H, x, z - 6));
  for (const b of bases) {
    let missing = want - b.massNear;
    const p = spawns[b.index];
    for (let tries = 0; missing > 0 && tries < 48; tries++) {
      const a = (tries / 48) * Math.PI * 2 * 3, d = 70 + (tries % 4) * 18;
      const q: Pt = [Math.round(p[0] + Math.cos(a) * d), Math.round(p[1] + Math.sin(a) * d)];
      if (q[0] < 16 || q[1] < 16 || q[0] > g.grid - 16 || q[1] > g.grid - 16) continue;
      if (slopeAt(q[0], q[1]) > 4 || (hasWater && sampleH(g, H, q[0], q[1]) < water + 2)) continue;
      if ([...mass, ...suggestions].some((m) => Math.hypot(m[0] - q[0], m[1] - q[1]) < 22)) continue;
      if (spawns.some((sp) => Math.hypot(sp[0] - q[0], sp[1] - q[1]) < 45)) continue;
      const wd = distAt(g, dists[b.index], q);
      if (wd < 0 || wd > 140) continue;
      suggestions.push(q);
      missing--;
    }
  }
  return { score: spawns.length < 2 ? 100 : score, bases, problems, suggestions };
}
