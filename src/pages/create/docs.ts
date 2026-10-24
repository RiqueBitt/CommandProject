// Formato dos documentos de cada tipo de projeto (salvos como JSON pelo núcleo) e os modelos
// iniciais. Sem three.js aqui: a biblioteca de projetos usa isto sem carregar os editores.
import { EMPTY_EDITS, type Edits } from "../studio/mapEdit";
import type { Feature, Symmetry, WorldGen } from "./worldgen";
import type { TexGenDoc } from "./texgen";

// ------------------------------------------------------------------ mapa

export interface MapDoc {
  schema: 1;
  terrain: string | null;
  lobbyName: string;
  teams: "2" | "ffa";
  economy: { baseMass: number; sites: number; perSite: number };
  norush: number;
  patch: boolean;
  maxSlope: number;
  waterMargin: number;
  smooth: boolean;
  rugged: boolean;
  minimap: "donor" | "natural" | "desert" | "snow" | "dark";
  strip: "moving" | "all" | "none";
  edits: Edits;
  /** modelos 3D próprios (projetos de modelo) usados como decoração: bp → projeto */
  models: { creation: string; name: string; bp: string }[];
  notes: string;
  /** gerador de mundo (relevo base); null = relevo do terreno do jogo */
  world: WorldGen | null;
  /** formas do terreno (montanhas, lagos, rios…), geradas ou colocadas à mão */
  features: Feature[];
  /** camada do pincel de escultura (int16 base64, 1/32 unidade) na resolução sculptSize */
  sculpt: string | null;
  sculptSize: number;
  /** simetria ao colocar objetos à mão */
  symmetry: Symmetry;
  /** grupos/objetos escondidos e travados no explorador */
  layers: { hidden: string[]; locked: string[] };
}

export const newMapDoc = (over: Partial<MapDoc> = {}): MapDoc => ({
  schema: 1, terrain: null, lobbyName: "Meu mapa", teams: "2", economy: { baseMass: 4, sites: 8, perSite: 3 }, norush: 70,
  patch: false, maxSlope: 6, waterMargin: 4, smooth: false, rugged: false, minimap: "donor", strip: "moving",
  edits: EMPTY_EDITS, models: [], notes: "", world: null, features: [], sculpt: null, sculptSize: 0, symmetry: "none",
  layers: { hidden: [], locked: [] }, ...over,
});

export function migrateMap(raw: unknown): MapDoc {
  const d = (raw ?? {}) as Partial<MapDoc>;
  const base = newMapDoc();
  return {
    ...base, ...d, economy: { ...base.economy, ...(d.economy ?? {}) }, edits: { ...EMPTY_EDITS, ...(d.edits ?? {}) }, models: d.models ?? [],
    features: d.features ?? [], layers: { hidden: d.layers?.hidden ?? [], locked: d.layers?.locked ?? [] }, schema: 1,
  };
}

// ------------------------------------------------------------------ modelo 3D

export type PartType = "box" | "cylinder" | "sphere" | "cone" | "torus" | "wedge" | "plane" | "capsule" | "mesh";
export type Vec3 = [number, number, number];

export interface PartMaterial {
  color: string;
  /** textura: arquivo do projeto ("asset") ou textura do jogo ("game", caminho .dds) */
  texture?: { source: "asset" | "game"; ref: string } | null;
  /** quantas vezes a textura repete em cada face */
  uvScale: number;
  roughness: number;
  metalness: number;
  /** cor que brilha (luzes, painéis) */
  emissive?: string | null;
  /** no jogo esta parte recebe a cor do time (como as faixas das unidades) */
  team?: boolean;
}

export interface ModelPart {
  id: string;
  name: string;
  type: PartType;
  /** dimensões da forma (largura/altura/profundidade, raio, segmentos…) */
  params: Record<string, number>;
  pos: Vec3;
  /** graus */
  rot: Vec3;
  scale: Vec3;
  group: string | null;
  material: PartMaterial;
  /** malha própria (importada ou com vértices editados), em coordenadas locais da peça */
  mesh?: { positions: number[]; indices: number[]; uvs?: number[] } | null;
  hidden?: boolean;
  locked?: boolean;
}

/** Grupo = osso no jogo (as armas e animações das tropas usam o nome do osso). */
export interface ModelGroup { id: string; name: string; parent: string | null; hidden?: boolean; pivot?: Vec3 }

export interface ModelDoc {
  schema: 1;
  parts: ModelPart[];
  groups: ModelGroup[];
  /** tamanho de referência no jogo (1 unidade ≈ 1 célula do mapa) */
  gridSize: number;
  notes: string;
}

export const defaultMaterial = (color = "#9aa7b4"): PartMaterial => ({ color, texture: null, uvScale: 1, roughness: 0.7, metalness: 0.1, emissive: null });

export const PART_DEFAULTS: Record<Exclude<PartType, "mesh">, Record<string, number>> = {
  box: { w: 2, h: 2, d: 2 },
  cylinder: { rt: 1, rb: 1, h: 2, seg: 24 },
  sphere: { r: 1, seg: 24 },
  cone: { r: 1, h: 2, seg: 24 },
  torus: { r: 1, tube: 0.3, seg: 24 },
  wedge: { w: 2, h: 2, d: 2 },
  plane: { w: 4, d: 4 },
  capsule: { r: 0.6, h: 1.6, seg: 16 },
};

let seq = 0;
export const newId = (p = "p") => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`;

export function newPart(type: Exclude<PartType, "mesh">, over: Partial<ModelPart> = {}): ModelPart {
  const h = PART_DEFAULTS[type].h ?? (type === "sphere" ? 2 : type === "plane" ? 0 : 1);
  return {
    id: newId(), name: PART_LABEL[type], type, params: { ...PART_DEFAULTS[type] },
    pos: [0, type === "plane" ? 0 : h / 2, 0], rot: [0, 0, 0], scale: [1, 1, 1], group: null, material: defaultMaterial(), ...over,
  };
}

export const PART_LABEL: Record<PartType, string> = {
  box: "Bloco", cylinder: "Cilindro", sphere: "Esfera", cone: "Cone", torus: "Anel", wedge: "Rampa", plane: "Placa", capsule: "Cápsula", mesh: "Malha",
};
export const PART_ICON: Record<PartType, string> = {
  box: "check_box_outline_blank", cylinder: "database", sphere: "circle", cone: "change_history", torus: "radio_button_unchecked",
  wedge: "signal_cellular_4_bar", plane: "crop_landscape", capsule: "medication", mesh: "deployed_code",
};

export const newModelDoc = (over: Partial<ModelDoc> = {}): ModelDoc => ({ schema: 1, parts: [], groups: [], gridSize: 1, notes: "", ...over });

export function migrateModel(raw: unknown): ModelDoc {
  const d = (raw ?? {}) as Partial<ModelDoc>;
  return {
    ...newModelDoc(), ...d, schema: 1,
    parts: (d.parts ?? []).map((p) => ({ ...p, material: { ...defaultMaterial(), ...(p.material ?? {}) } })),
    groups: d.groups ?? [],
  };
}

/** Modelos iniciais (para começar com algo na tela). */
export const MODEL_TEMPLATES: { id: string; name: string; desc: string; make: () => ModelDoc }[] = [
  { id: "empty", name: "Vazio", desc: "Comece do zero com as formas básicas.", make: () => newModelDoc() },
  {
    id: "tower", name: "Torre de vigia", desc: "Base, coluna, plataforma e luz no topo.",
    make: () => {
      const g = { id: newId("g"), name: "Torre", parent: null };
      return newModelDoc({
        groups: [g],
        parts: [
          newPart("cylinder", { name: "Base", params: { rt: 2.2, rb: 2.6, h: 1, seg: 8 }, pos: [0, 0.5, 0], group: g.id, material: defaultMaterial("#5b6470") }),
          newPart("cylinder", { name: "Coluna", params: { rt: 0.8, rb: 1, h: 8, seg: 12 }, pos: [0, 5, 0], group: g.id, material: defaultMaterial("#8a939e") }),
          newPart("box", { name: "Plataforma", params: { w: 4, h: 0.5, d: 4 }, pos: [0, 9.25, 0], group: g.id, material: defaultMaterial("#4f5862") }),
          newPart("sphere", { name: "Luz", params: { r: 0.6, seg: 16 }, pos: [0, 10.2, 0], group: g.id, material: { ...defaultMaterial("#ffe08a"), emissive: "#ffb800" } }),
        ],
      });
    },
  },
  {
    id: "crates", name: "Caixas de suprimento", desc: "Pilha de caixas para decorar bases.",
    make: () => newModelDoc({
      parts: [
        newPart("box", { name: "Caixa 1", params: { w: 2, h: 1.6, d: 2 }, pos: [0, 0.8, 0], material: defaultMaterial("#8b6b3d") }),
        newPart("box", { name: "Caixa 2", params: { w: 2, h: 1.6, d: 2 }, pos: [2.2, 0.8, 0.3], rot: [0, 12, 0], material: defaultMaterial("#7a5d34") }),
        newPart("box", { name: "Caixa 3", params: { w: 1.8, h: 1.4, d: 1.8 }, pos: [1, 2.3, 0.1], rot: [0, -8, 0], material: defaultMaterial("#94743f") }),
      ],
    }),
  },
  {
    id: "tank", name: "Tanque simples", desc: "Chassi, esteiras, torre e canhão: base para uma tropa.",
    make: () => {
      const g = { id: newId("g"), name: "Tanque", parent: null };
      const tur = { id: newId("g"), name: "Torre", parent: g.id };
      return newModelDoc({
        groups: [g, tur],
        parts: [
          newPart("box", { name: "Chassi", params: { w: 2.4, h: 0.8, d: 3.6 }, pos: [0, 0.9, 0], group: g.id, material: defaultMaterial("#56645a") }),
          newPart("box", { name: "Esteira esquerda", params: { w: 0.6, h: 0.8, d: 3.8 }, pos: [-1.4, 0.4, 0], group: g.id, material: defaultMaterial("#2c2f33") }),
          newPart("box", { name: "Esteira direita", params: { w: 0.6, h: 0.8, d: 3.8 }, pos: [1.4, 0.4, 0], group: g.id, material: defaultMaterial("#2c2f33") }),
          newPart("cylinder", { name: "Torre", params: { rt: 0.9, rb: 1.1, h: 0.7, seg: 16 }, pos: [0, 1.65, -0.2], group: tur.id, material: defaultMaterial("#647468") }),
          newPart("cylinder", { name: "Canhão", params: { rt: 0.14, rb: 0.18, h: 2.4, seg: 12 }, pos: [0, 1.7, 1.3], rot: [90, 0, 0], group: tur.id, material: defaultMaterial("#3d4441") }),
        ],
      });
    },
  },
];

// ------------------------------------------------------------------ tropa

export interface UnitDoc {
  schema: 1;
  /** unidade do jogo usada como base (ex.: "uul0101") */
  base: string | null;
  /** id da unidade nova (pasta /units/<id>/) */
  newId: string;
  name: string;
  description: string;
  /** valores alterados no blueprint, por caminho ("Defense.MaxHealth", "Weapon.1.Damage") */
  overrides: Record<string, number | string | boolean>;
  categoriesAdd: string[];
  categoriesRemove: string[];
  appearance: {
    model: { source: "base" } | { source: "creation"; creation: string; name: string };
    /** escala geral do modelo no jogo (UniformScale) */
    scale: number | null;
    /** ajuste de cor da textura (matiz em graus, saturação e brilho em %) */
    tint: { hue: number; sat: number; bright: number };
    /** textura pintada/importada (arquivo do projeto) que substitui a do jogo */
    albedoAsset: string | null;
    /** ícone (arquivo do projeto) que substitui o da base */
    iconAsset?: string | null;
    /** assistente de ossos: osso da base → grupo do modelo próprio */
    boneMap?: Record<string, string>;
  };
  /** animações: campo do blueprint (ex.: "AnimationWalk") → arquivo .sca do jogo ou do projeto */
  animations: Record<string, { file: string; rate?: number | null }>;
  /** animações feitas aqui (quadros-chave), para reabrir e editar */
  customAnims?: { name: string; field: string; duration: number; keys: { bone: string; time: number; pos: [number, number, number]; rot: [number, number, number] }[]; asset?: string | null }[];
  /** armas copiadas de outras unidades: [posição na tropa (0 = nova), unidade, posição lá] */
  weaponCopies?: [number, string, number][];
  /** pacote de tropas (várias tropas num mod só) */
  pack?: string | null;
  /** misturador: chassi = base; torre e arma de outras unidades */
  mix?: { chassis: string; turret: string | null; weapon: string | null; turretScale: number; weaponScale: number; turretOffset: [number, number, number]; turretYaw: number } | null;
  /** gerador de texturas (camadas e sementes) */
  texgen?: TexGenDoc | null;
  notes: string;
}

export const newUnitDoc = (over: Partial<UnitDoc> = {}): UnitDoc => ({
  schema: 1, base: null, newId: "", name: "Nova tropa", description: "", overrides: {}, categoriesAdd: [], categoriesRemove: [],
  appearance: { model: { source: "base" }, scale: null, tint: { hue: 0, sat: 0, bright: 0 }, albedoAsset: null },
  animations: {}, notes: "", ...over,
});

export function migrateUnit(raw: unknown): UnitDoc {
  const d = (raw ?? {}) as Partial<UnitDoc>;
  const base = newUnitDoc();
  return { ...base, ...d, schema: 1, appearance: { ...base.appearance, ...(d.appearance ?? {}), tint: { ...base.appearance.tint, ...(d.appearance?.tint ?? {}) } }, overrides: d.overrides ?? {}, animations: d.animations ?? {} };
}

/** id de unidade novo: "cp" + 4 letras do nome + 2 dígitos (minúsculo, como os do jogo). */
export function suggestUnitId(name: string, taken: Set<string> = new Set()): string {
  const letters = name.normalize("NFD").replace(/[^a-zA-Z]/g, "").toLowerCase().slice(0, 4).padEnd(4, "x");
  for (let n = 1; n < 100; n++) {
    const id = `cp${letters}${String(n).padStart(2, "0")}`;
    if (!taken.has(id)) return id;
  }
  return `cp${Date.now().toString(36).slice(-6)}`;
}
