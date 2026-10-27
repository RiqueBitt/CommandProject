// Novidades de cada versão (mostradas uma vez depois de atualizar, e pela busca: "Novidades").
// Textos em português (chaves do i18n), do mais novo para o mais antigo.

export interface NewsItem { icon: string; title: string; text: string; page?: string }
export interface Release { version: string; title: string; items: NewsItem[] }

export const CHANGELOG: Release[] = [
  {
    version: "0.34.0",
    title: "Partidas com amigos, Forja turbinada e novos climas",
    items: [
      { icon: "group_add", title: "Partida grande com amigos", text: "Marque bases como Amigo, copie o convite e mande para quem quiser: eles colam o código e entram direto na sua partida, até com mais de 8 jogadores. Sem servidor e sem conta.", page: "bigmatch" },
      { icon: "code", title: "Editor de mods da Forja", text: "Edite os mods no launcher com autocompletar da API, ajuda ao passar o mouse e avisos do Lua 5.0 do jogo. Ao salvar, o mod já entra na próxima partida.", page: "forja" },
      { icon: "dashboard_customize", title: "Modelos de mod", text: "Comece um mod da Forja a partir de um modelo: balanceamento, painel, regra de jogo ou biblioteca.", page: "forja" },
      { icon: "foggy", title: "Neblina e tempestade de areia", text: "Dois climas novos na Partida grande, e a opção de clima que muda durante a partida (o mesmo para todos).", page: "bigmatch" },
      { icon: "auto_awesome", title: "Remaster HD", text: "As texturas do jogo com três estilos (Fiel, Vivo e Cinematográfico), força por superfície e galeria de prévias.", page: "studio" },
      { icon: "search", title: "Busca em tudo", text: "Ctrl+K agora acha páginas, ações, mods, projetos, mapas e configurações, com ou sem acento." },
      { icon: "store", title: "Mods da Forja no Hub", text: "Filtro e selo para mods da Forja; as dependências são instaladas junto.", page: "hub" },
      { icon: "palette", title: "Visual renovado", text: "Telas com a arte dos menus do próprio jogo (lida da sua instalação) e o launcher abre mais rápido." },
    ],
  },
  {
    version: "0.33.0",
    title: "Forja, o carregador de mods",
    items: [
      { icon: "construction", title: "Forja", text: "Vários mods juntos sem brigar: eventos, comandos, painéis e mudanças de unidades por uma API, com dependências e erros isolados.", page: "forja" },
      { icon: "menu_book", title: "Guia para criar mods", text: "Tudo explicado no guia da Forja, com exemplos." },
    ],
  },
  {
    version: "0.32.0",
    title: "Clima nos materiais e nos modelos",
    items: [
      { icon: "water_drop", title: "Chão molhado e neve", text: "Cada material do mapa fica molhado ou nevado do seu jeito, e as unidades e prédios também.", page: "bigmatch" },
    ],
  },
];

/** Comparação simples de versões x.y.z. */
export function newer(a: string, b: string): boolean {
  const pa = a.split(/[.+-]/).map((n) => parseInt(n, 10) || 0);
  const pb = b.split(/[.+-]/).map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  return false;
}

/** As versões entre a última vista (sem incluir) e a atual (incluída). */
export function releasesSince(seen: string | null, current: string): Release[] {
  return CHANGELOG.filter((r) => !newer(r.version, current) && (!seen || newer(r.version, seen)));
}
