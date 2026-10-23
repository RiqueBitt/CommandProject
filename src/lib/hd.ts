/** Mods de Texturas HD gerados antes do gerador 2.0 mexiam em tabelas de cor/iluminação e ampliavam ícones. */
export const hdOutdated = (version?: string | null) => !!version && !version.startsWith("2.");
