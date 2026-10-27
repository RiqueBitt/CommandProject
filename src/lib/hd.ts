/** Mods de Texturas HD gerados antes do gerador 3.0 não têm o Remaster (e os 1.x mexiam em tabelas de cor). */
export const hdOutdated = (version?: string | null) => !!version && !version.startsWith("3.");
