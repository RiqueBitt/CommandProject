// Atmosfera do mapa: ajustes no info.win.bdf sobre a luz do terreno base (campos documentados pelo
// SupCom2-map-editor, de maksing, licença MIT). As cores são multiplicadores — o mapa continua
// combinando com a luz assada do terreno — e a "força" mistura o neutro com o estilo escolhido.

export interface Atmosphere {
  /** id em ATMOSPHERES ("" = a do terreno base) */
  preset: string;
  /** 0 a 1.5: quanto do estilo entra */
  strength: number;
  /** direção do vento em graus (0 = leste, 90 = sul) */
  windDir: number;
  /** força do vento (0 a 2); null = a do terreno base */
  wind: number | null;
}

type RGB = [number, number, number];
interface Style { label: string; desc: string; sun?: RGB; sunPower?: number; shadow?: RGB; water?: RGB; fog?: RGB; fogAmount?: number; bloom?: number; preview: RGB }

export const ATMOSPHERES: Record<string, Style> = {
  sunset: { label: "Pôr do sol", desc: "Sol baixo e alaranjado, sombras arroxeadas.", sun: [1.25, 0.82, 0.55], sunPower: 0.95, shadow: [1.05, 0.85, 1.2], water: [1.15, 0.85, 0.75], fog: [1.3, 0.85, 0.65], fogAmount: 1.2, bloom: 1.3, preview: [255, 150, 90] },
  dawn: { label: "Amanhecer", desc: "Luz rosada e fria, névoa leve.", sun: [1.1, 0.9, 0.95], sunPower: 0.85, shadow: [0.9, 0.95, 1.2], fog: [1.1, 0.95, 1.1], fogAmount: 1.3, preview: [240, 180, 200] },
  night: { label: "Noite", desc: "Luar azulado: tudo mais escuro, mas jogável.", sun: [0.55, 0.68, 1.05], sunPower: 0.5, shadow: [0.55, 0.6, 0.9], water: [0.5, 0.6, 0.9], fog: [0.4, 0.45, 0.7], fogAmount: 1.1, bloom: 1.5, preview: [60, 80, 150] },
  overcast: { label: "Nublado e chuvoso", desc: "Luz cinza e difusa, neblina no horizonte.", sun: [0.85, 0.88, 0.92], sunPower: 0.7, shadow: [1.15, 1.15, 1.2], water: [0.8, 0.85, 0.85], fog: [0.95, 0.97, 1.0], fogAmount: 1.6, bloom: 0.7, preview: [150, 160, 170] },
  fog: { label: "Neblina densa", desc: "A neblina fecha o horizonte (as unidades continuam visíveis).", sunPower: 0.85, shadow: [1.1, 1.1, 1.1], fog: [1.05, 1.05, 1.05], fogAmount: 2.6, bloom: 0.8, preview: [200, 205, 210] },
  desert: { label: "Calor do deserto", desc: "Sol forte e amarelo, ar empoeirado.", sun: [1.2, 1.05, 0.8], sunPower: 1.15, shadow: [1.1, 0.95, 0.85], water: [0.9, 1.0, 0.9], fog: [1.25, 1.05, 0.8], fogAmount: 1.3, bloom: 1.2, preview: [235, 200, 130] },
  ice: { label: "Frio polar", desc: "Luz branca e azul, água gelada.", sun: [0.92, 1.0, 1.15], sunPower: 1.05, shadow: [0.85, 0.95, 1.25], water: [0.75, 0.95, 1.15], fog: [0.9, 1.0, 1.15], fogAmount: 1.2, preview: [190, 220, 250] },
  volcanic: { label: "Vulcânico", desc: "Céu avermelhado e cinzas no ar.", sun: [1.3, 0.7, 0.5], sunPower: 0.9, shadow: [1.2, 0.75, 0.7], water: [1.1, 0.6, 0.5], fog: [1.2, 0.6, 0.45], fogAmount: 1.7, bloom: 1.6, preview: [200, 80, 50] },
  alien: { label: "Planeta alienígena", desc: "Luz esverdeada e sombras roxas.", sun: [0.85, 1.2, 0.8], shadow: [1.15, 0.8, 1.25], water: [0.7, 1.2, 0.9], fog: [0.8, 1.15, 0.9], fogAmount: 1.3, bloom: 1.4, preview: [120, 200, 110] },
};

const mix = (a: number, k: number) => Math.round((1 + (a - 1) * k) * 1000) / 1000;
const mix3 = (c: RGB | undefined, k: number): RGB | undefined => (c ? [mix(c[0], k), mix(c[1], k), mix(c[2], k)] : undefined);

/** O que vai para o construtor de mapas (null = não muda nada). */
export function atmosphereSpec(a: Atmosphere | null | undefined): Record<string, unknown> | null {
  if (!a) return null;
  const st = ATMOSPHERES[a.preset];
  const k = Math.max(0, Math.min(1.5, a.strength));
  const out: Record<string, unknown> = {};
  if (st && k > 0) {
    const put = (key: string, v: unknown) => { if (v !== undefined) out[key] = v; };
    put("sun", mix3(st.sun, k));
    put("shadow", mix3(st.shadow, k));
    put("water", mix3(st.water, k));
    put("fog", mix3(st.fog, k));
    if (st.sunPower !== undefined) out.sun_power = mix(st.sunPower, k);
    if (st.fogAmount !== undefined) out.fog_amount = mix(st.fogAmount, k);
    if (st.bloom !== undefined) out.bloom = mix(st.bloom, k);
  }
  if (a.wind !== null && a.wind !== undefined) {
    out.wind = Math.max(0, Math.min(2, a.wind));
    out.wind_dir = Math.round(a.windDir) % 360;
  }
  return Object.keys(out).length ? out : null;
}

/** Cor do céu na prévia 3D: a do céu escolhido tingida pela atmosfera. */
export function tintSky(sky: RGB | null, a: Atmosphere | null | undefined): RGB | null {
  const st = a ? ATMOSPHERES[a.preset] : undefined;
  if (!st || !a) return sky;
  const k = Math.max(0, Math.min(1, a.strength));
  const base: RGB = sky ?? [150, 180, 210];
  return base.map((c, i) => Math.round(c * (1 - k * 0.6) + st.preview[i] * k * 0.6)) as RGB;
}
