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
