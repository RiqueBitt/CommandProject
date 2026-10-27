// Partes do app ligadas/desligadas. O editor de tropas está pausado enquanto o foco é o gerador e o
// editor de mapas: o código continua no projeto (os projetos de tropa existentes não se perdem) e
// volta trocando a chave abaixo.
export const UNITS_ENABLED = false;

export const FEATURES = {
  /** mod Primeira Pessoa: escondido e desligado por enquanto (o código continua no projeto) */
  firstPerson: false,
};

/** mods do CommandProject que não aparecem nas listas enquanto o recurso deles está desligado */
export const HIDDEN_MOD_IDS: string[] = FEATURES.firstPerson ? [] : ["cp-primeira-pessoa"];

export const visibleMods = <T extends { manifest: { id: string } }>(mods: T[]): T[] =>
  HIDDEN_MOD_IDS.length ? mods.filter((m) => !HIDDEN_MOD_IDS.includes(m.manifest.id)) : mods;

/** Mods que fazem parte do launcher (recursos dele): não aparecem na aba Mods, ficam em "Recursos do
 *  launcher". O único do CommandProject que aparece em Mods é o de Trapaças. */
export const LAUNCHER_MOD_IDS = [
  "cp-primeira-pessoa", "cp-ia-esperta", "cp-otimizacao", "cp-partida-grande", "cp-clima", "cp-clima-modelos",
  "texturas-hd", "menu-moderno", "cp-jogo-ptbr", "cp-forja",
];
export const isLauncherMod = (id: string) => LAUNCHER_MOD_IDS.includes(id);
/** só os mods que aparecem na aba Mods (os do usuário e as Trapaças) */
export const userMods = <T extends { manifest: { id: string } }>(mods: T[]): T[] => mods.filter((m) => !isLauncherMod(m.manifest.id));
