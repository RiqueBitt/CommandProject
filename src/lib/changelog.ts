// Novidades de cada versão (mostradas uma vez depois de atualizar, e pela busca: "Novidades").
// Textos em português (chaves do i18n), do mais novo para o mais antigo.

export interface NewsItem { icon: string; title: string; text: string; page?: string }
export interface Release { version: string; title: string; items: NewsItem[] }

export const CHANGELOG: Release[] = [
  {
    version: "0.49.0",
    title: "Mais minigames, mutadores e desafios",
    items: [
      { icon: "sports_esports", title: "5 modos novos", text: "Rei da Colina (uma colina que muda de lugar), Escolta (proteja o VIP do seu time), Corrida de Recursos (primeiro a produzir a meta de massa), Sobrevivência Infinita (ondas até a base cair, com chefe a cada 5) e Caça ao Tesouro (caixas com prêmios pelo mapa).", page: "home" },
      { icon: "tune", title: "Mutadores e eventos", text: "Só aéreo, vida em dobro, renda em dobro e comandantes resistentes, em qualquer partida. Eventos aleatórios: chuva de meteoros numa área marcada, reforço para quem está atrás, pesquisa e suprimentos. Na sala do jogo, a seção EXTRAS tem combinações prontas (Eventos, Caos, Só aéreo, Tanques).", page: "home" },
      { icon: "leaderboard", title: "Placar fixo, sons e defesa mais esperta", text: "O placar dos minigames fica fixo no canto da tela, e pontos tomados e ondas tocam sons do próprio jogo. A Defesa tem chefe na onda final (e a cada 5) e a dificuldade acompanha o seu desempenho: limpou rápido, a próxima onda cresce; está sofrendo, chegam mais suprimentos.", page: "home" },
      { icon: "workspace_premium", title: "Desafio da semana, conquistas, histórico e torneio", text: "No Início, o quadro Minigames ganhou abas: o desafio da semana (mesmo modo, mutadores e mapa para todos), 16 conquistas, o histórico das últimas partidas com gráfico, e uma chave de torneio entre amigos.", page: "home" },
      { icon: "map", title: "Prévia dos pontos de controle", text: "Na Partida grande, a prévia do mapa mostra onde ficam os pontos de controle e a colina antes de jogar.", page: "home" },
    ],
  },
  {
    version: "0.48.0",
    title: "Minigames: 5 modos novos",
    items: [
      { icon: "flag", title: "Dominação Estratégica", text: "Pontos de controle marcados com setas no mapa: o time que fica sozinho num ponto por 5 segundos toma o ponto, e cada ponto dá 1 ponto por segundo (e um pouco de recursos). Vence quem chega primeiro à pontuação-alvo. A IA também disputa os pontos.", page: "bigmatch" },
      { icon: "smart_toy", title: "Arena dos Experimentais", text: "Cada jogador começa com 1 a 5 experimentais da sua facção no lugar do comandante. Depois de 3 minutos a zona segura fecha no centro. Vence o último que sobrar.", page: "bigmatch" },
      { icon: "shield", title: "Última Linha de Defesa", text: "Tempo para montar a base e depois ondas de inimigos cada vez maiores, com experimentais a cada 5 ondas e suprimentos entre elas. Dá para jogar sozinho ou com aliados.", page: "bigmatch" },
      { icon: "public", title: "Guerra Total e Projeto Supremo", text: "Guerra Total: mais recursos no começo e pontos estratégicos que dão massa, energia e pesquisa. Projeto Supremo: a pesquisa vem das eliminações e dos pontos, com níveis que dão bônus.", page: "bigmatch" },
      { icon: "emoji_events", title: "Onde escolher e recordes", text: "No jogo: Batalha → Criar jogo, seção MODO (e atalhos da Defesa e da Arena no submenu Batalha). No launcher: Partida grande → Minigame. Mensagens na tela explicam o objetivo e mostram o placar; os resultados viram recordes no Início.", page: "bigmatch" },
    ],
  },
  {
    version: "0.47.0",
    title: "Grande atualização de otimização",
    items: [
      { icon: "bolt", title: "Otimização: o jogo abre e roda mais leve", text: "O launcher guarda a tela inicial já montada e só refaz quando algo muda, guarda o índice dos arquivos grandes e anota quanto tempo cada passo do Jogar levou (logs/aplicar-tempos.log). O ReShade passa a compilar os efeitos no modo desempenho e não carrega os desligados.", page: "settings" },
      { icon: "speed", title: "Gráficos leves para partidas grandes", text: "Nova opção em Opções → Vídeo: Gráficos leves (Desligado, Leve, Forte). Reduz o detalhe dos modelos de longe e as marcas no terreno, para partidas com muitos jogadores rodarem melhor.", page: "settings" },
      { icon: "image", title: "Miniaturas dos mapas na sala", text: "Os mapas do painel de Partida grande na sala de Batalha aparecem com a miniatura de cada um.", page: "settings" },
      { icon: "replay", title: "Jogar de novo", text: "Na tela de resultado, um botão Jogar de novo começa a mesma partida grande outra vez, com as mesmas escolhas.", page: "settings" },
      { icon: "check_circle", title: "Aviso do que foi aplicado", text: "Quando você muda o perfil, os mods ou a cor pelo painel do jogo, as notícias da tela inicial mostram o que o launcher aplicou.", page: "settings" },
      { icon: "build", title: "Mais ferramentas em Sistema", text: "Partida grande, Recursos, Desempenho, Arquivos, Ícones e Rede continuam no launcher, agora juntos em Sistema → Mais ferramentas. E o botão Fechar o jogo travado aparece sempre no Início.", page: "settings" },
    ],
  },
  {
    version: "0.46.0",
    title: "O launcher vira editor, o resto vai para o jogo",
    items: [
      { icon: "tune", title: "O launcher dentro do jogo", text: "No submenu Extras da tela inicial, um painel com o perfil de mods, ligar e desligar cada mod, a cor da tela inicial, a memória e a prioridade do jogo. O que você escolhe lá o launcher aplica na próxima vez que você clica em Jogar.", page: "settings" },
      { icon: "edit", title: "Launcher focado em criar", text: "A barra lateral fica com Início (Jogar), Mapas, Modelos, Mods, Forja e Sistema. A tela inicial do jogo (logo, vídeo e cor) foi para Sistema; Partida grande, Arquivos, Ícones, Recursos e Rede saíram da barra (o que dá, agora fica no jogo).", page: "settings" },
    ],
  },
  {
    version: "0.45.0",
    title: "Mais do launcher dentro do jogo",
    items: [
      { icon: "tune", title: "Partida grande completa na sala de batalha", text: "O painel da sala ganhou sua facção, tipo de vitória e limite de unidades. As escolhas ficam guardadas no seu perfil do jogo e valem na próxima partida.", page: "features" },
      { icon: "sports_esports", title: "Modos prontos no submenu Batalha", text: "Guerra 8 contra 8, Todos contra todos (12) e Guerra total (32), cada um no menor mapa que cabe, com a IA e as opções que você escolheu.", page: "features" },
      { icon: "folder", title: "Trapaças e perfis no submenu Extras", text: "Ligar ou desligar as trapaças da partida grande e escolher o perfil de mods: o launcher troca para ele na próxima vez que você clicar em Jogar.", page: "features" },
      { icon: "newspaper", title: "Notícias com o resumo do launcher", text: "Sem um texto seu, o painel de notícias mostra a versão do launcher, quantos mods estão ligados e o perfil.", page: "features" },
    ],
  },
  {
    version: "0.44.1",
    title: "Escaramuça agora é Batalha",
    items: [
      { icon: "translate", title: "Escaramuça agora é Batalha", text: "No jogo em português, o menu e tudo que dizia \"Escaramuça\" agora diz \"Batalha\" (botão da tela inicial, sala, conquistas e dicas).", page: "features" },
    ],
  },
  {
    version: "0.44.0",
    title: "Partida grande na sala do jogo, abertura rápida",
    items: [
      { icon: "sports_esports", title: "Partida grande dentro do Criar jogo do jogo", text: "A Partida grande agora fica na própria sala de escaramuça (Escaramuça → Criar jogo), num painel à esquerda da mesma janela: 10 a 32 jogadores, times, dificuldade da IA e os mapas grandes, com o botão Iniciar partida grande. As partidas de até 8 continuam pela sala como sempre.", page: "features" },
      { icon: "bolt", title: "O jogo abre mais rápido", text: "Sem os vídeos de abertura (logos e aviso legal): o jogo vai direto para a tela inicial. O launcher também guarda o índice dos arquivos grandes (texturas HD, mapas) e não lê tudo de novo a cada Jogar.", page: "features" },
    ],
  },
  {
    version: "0.43.0",
    title: "Criar jogo de até 32 no próprio jogo, mais opções",
    items: [
      { icon: "sports_esports", title: "Criar jogo novo na Escaramuça", text: "O painel ao lado da Escaramuça agora é o Criar jogo: de 2 a 32 jogadores, times, dificuldade da IA, a sua facção, o tipo de vitória, o limite de unidades e os mapas (os do jogo e os seus). A sala antiga do jogo virou \"Sala clássica\".", page: "features" },
      { icon: "tune", title: "Mais opções no jogo", text: "Opções que o jogo tinha escondidas no PC aparecem: informações na dica de construção, atraso das dicas, barras de vida das unidades, alertas de economia, barras das unidades acopladas e renderizar o céu. A janela ficou maior e mais organizada.", page: "features" },
      { icon: "auto_awesome", title: "Campanha e menus mais bonitos", text: "Moldura neon na imagem da operação, filetes de destaque nos títulos e botões Voltar/Iniciar no estilo novo. A IA \"Trapaça\" agora se chama \"Muito difícil\".", page: "features" },
    ],
  },
  {
    version: "0.42.0",
    title: "Partida grande no menu do jogo, menus novos",
    items: [
      { icon: "groups", title: "Partida grande direto na Escaramuça", text: "Na tela inicial nova, ao abrir a Escaramuça aparece um painel ao lado: jogadores (até 32), times, a IA e o mapa (os maiores, os seus também). Escolha e clique em Começar. Testado no jogo.", page: "features" },
      { icon: "palette", title: "Outros menus no estilo da tela inicial", text: "Criar jogo, campanha, opções e multijogador ganham os botões, painéis e abas com borda neon da tela inicial, e a faixa de cima vai de uma borda à outra.", page: "features" },
      { icon: "image", title: "Logo novo e ícones brancos", text: "O logo do CommandProject vem como padrão (dá para trocar pelo seu) e os ícones dos botões aparecem brancos (antes ficavam por baixo do fundo do botão).", page: "features" },
    ],
  },
  {
    version: "0.41.0",
    title: "Partida grande dentro do jogo",
    items: [
      { icon: "groups", title: "Partida grande no menu do jogo", text: "Com a Tela inicial nova ligada, Escaramuça → Partida grande (até 32) abre uma tela no próprio jogo: escolha jogadores (até 32), times, a IA e o mapa (os maiores, os seus também) e clique em Começar.", page: "features" },
    ],
  },
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
