// Novidades de cada versão (mostradas uma vez depois de atualizar, e pela busca: "Novidades").
// Textos em português (chaves do i18n), do mais novo para o mais antigo.

export interface NewsItem { icon: string; title: string; text: string; page?: string }
export interface Release { version: string; title: string; items: NewsItem[] }

export const CHANGELOG: Release[] = [
  {
    version: "0.40.0",
    title: "Todos os menus no estilo novo",
    items: [
      { icon: "palette", title: "Menus remasterizados", text: "Criar partida, opções, multijogador, campanha e resumos ganham o visual da Tela inicial nova: tom escuro por cima do vídeo, faixa de cima escura e botões, painéis e listas na cor que você escolher.", page: "features" },
      { icon: "category", title: "Ícones brancos", text: "Os ícones dos botões da tela inicial ficam todos brancos.", page: "features" },
    ],
  },
  {
    version: "0.39.1",
    title: "Tela inicial nova e botões de mods no menu do jogo",
    items: [
      { icon: "space_dashboard", title: "Tela inicial nova", text: "Logo em cima, botões grandes com ícone e borda neon, submenus ao lado, caixa do jogador e notícias, na cor que você quiser (azul por padrão). Dá para usar o seu logo e o seu vídeo de fundo.", page: "features" },
      { icon: "smart_button", title: "Botões de mods na tela inicial", text: "Mods da Forja põem botões no menu principal ou no Extras, trocam nomes e escondem botões, com código em menu.lua ou só mensagem, site ou uma tela do jogo (como a partida em rede local).", page: "forja" },
      { icon: "build", title: "Vários mods juntos sem travar", text: "Mods com texturas e cenas da interface não brigam mais pelo índice do jogo (o jogo fechava ao abrir com três desses ligados).", page: "library" },
      { icon: "groups", title: "Partida grande na tela inicial", text: "Na tela Partida grande, \"Pôr na tela inicial do jogo\" vira um botão no submenu Escaramuça que começa aquela partida direto do jogo.", page: "bigmatch" },
      { icon: "play_arrow", title: "Perfil aplicado antes de jogar", text: "Com \"mods só pelo launcher\", o perfil é aplicado sempre antes de abrir o jogo.", page: "home" },
    ],
  },
  {
    version: "0.38.0",
    title: "A paisagem em volta do mapa do seu jeito",
    items: [
      { icon: "landscape", title: "Paisagem em volta editável", text: "Esculpa as montanhas fora da borda do mapa com os pincéis de relevo, coloque prédios e árvores lá fora ou povoe o horizonte com mata, cidade, rochas ou ruínas.", page: "create" },
    ],
  },
  {
    version: "0.37.0",
    title: "Jogar por IP, atmosfera dos mapas e a Forja conhecendo o jogo",
    items: [
      { icon: "lan", title: "Jogar por IP, sem a Steam", text: "Partidas privadas pela rede local, VPN ou internet com o SC2-Proxima. O launcher baixa e coloca só enquanto você joga por aqui; pela Steam o jogo continua o de sempre.", page: "multiplayer" },
      { icon: "wb_twilight", title: "Atmosfera dos mapas", text: "Pôr do sol, noite, neblina, deserto, vulcânico e mais no editor de mapas, com força ajustável e vento.", page: "create" },
      { icon: "code", title: "Forja conhece o jogo", text: "O autocompletar e a ajuda da Forja agora mostram as 461 funções e 51 tabelas do próprio motor.", page: "forja" },
      { icon: "mouse", title: "Mouse preso na janela", text: "No modo janela, o mouse fica dentro do jogo enquanto ele está na frente (Configurações).", page: "settings" },
    ],
  },
  {
    version: "0.36.0",
    title: "Mods só pelo launcher e recursos já incluídos",
    items: [
      { icon: "sports_esports", title: "Mods só pelo launcher", text: "Os mods entram no jogo só quando você joga pelo launcher. Abrindo o Supreme Commander 2 direto pela Steam, ele fica original, sem mods.", page: "settings" },
      { icon: "verified", title: "Recursos do launcher", text: "Partida grande, Climas, Remaster HD, Menu moderno, IA esperta, Otimização e os outros já vêm com o launcher, numa tela própria: é só ligar.", page: "features" },
      { icon: "extension", title: "Aba Mods mais limpa", text: "A aba Mods mostra só os seus mods e as Trapaças.", page: "library" },
    ],
  },
  {
    version: "0.35.0",
    title: "Sala de convite com voz, mar e ilhas e um editor de mapas mais esperto",
    items: [
      { icon: "meeting_room", title: "Sala de convite", text: "Quem entra baixa sozinho os mods e o mapa personalizado do anfitrião, vê quem está pronto e o jogo de todos abre junto quando ele começa. O convite é cifrado: o IP não aparece.", page: "bigmatch" },
      { icon: "mic", title: "Chat de voz", text: "Voz na sala, com microfone aberto ou apertar para falar com uma tecla que funciona dentro do jogo.", page: "bigmatch" },
      { icon: "sailing", title: "Mar e ilhas", text: "Mares gigantes com cada base na sua ilha, uma ilha por time, continente ou arquipélago, com o tamanho das ilhas e a ligação à sua escolha.", page: "create" },
      { icon: "draw", title: "Esboço vira mapa", text: "Desenhe com cores ou descreva o mapa em uma frase, e o editor monta o relevo.", page: "create" },
      { icon: "balance", title: "Equilíbrio, régua, carimbos e erosão", text: "Nota de equilíbrio das bases, tempo de viagem, carimbos de terreno, pincel de erosão, câmera do jogo e linha do tempo das versões.", page: "create" },
      { icon: "code", title: "Forja ainda melhor", text: "Erros de sintaxe na hora, trechos prontos, abas, busca, formulário do mod, testar no jogo com um clique e empacotar para o Hub.", page: "forja" },
      { icon: "air", title: "Som do clima no jogo", text: "O vento e o mar do próprio jogo tocam dentro da partida, no lugar do som do launcher.", page: "bigmatch" },
    ],
  },
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
