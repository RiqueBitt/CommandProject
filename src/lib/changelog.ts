// Novidades de cada versão (mostradas uma vez depois de atualizar, e pela busca: "Novidades").
// Textos em português (chaves do i18n), do mais novo para o mais antigo.

export interface NewsItem { icon: string; title: string; text: string; page?: string }
export interface Release { version: string; title: string; items: NewsItem[] }

export const CHANGELOG: Release[] = [
  {
    version: "0.59.0",
    title: "IA: bairro Ressurreição e construtores escondidos",
    items: [
      { icon: "church", title: "Bairro Ressurreição", text: "Depois dos primeiros minutos, a IA planeja uma base escondida longe da principal: em terra plana, longe dos caminhos que você usa e dos lugares onde ela perdeu unidades, mais perto da casa dela do que da sua. A base é muito fortificada (quatro torres, três antiaéreos, três escudos, fábrica de terra e de aviação), não tem radar e não aparece no mapinha do painel. Se o comandante morrer ou a base principal estiver caindo, essa base passa a ser a prioridade dos construtores, e a fábrica dela continua mandando exército para atacar.", page: "mods" },
      { icon: "rocket_launch", title: "Cápsula de fuga", text: "A IA pesquisa a cápsula de fuga do comandante. Quando ele está quase destruído e sob ataque, a IA lança a cápsula, que voa até o bairro Ressurreição (ou outro lugar escondido) e constrói um comandante novo lá. O comandante novo fica nessa base até a principal ser reconstruída e estar segura.", page: "mods" },
      { icon: "engineering", title: "Construtores escondidos", text: "A IA esconde engenheiros pelo mapa: um em terra (dois nos níveis difíceis) e um na água quando o mapa tem mar, longe do inimigo e longe uns dos outros. Se forem achados, mudam de esconderijo. Se a base principal for destruída, eles saem e constroem uma fábrica nova: na base, se ela estiver livre, ou ali mesmo onde estavam escondidos. No modo Supremacia e na Guerra Infinita, a IA continua jogando mesmo sem comandante.", page: "mods" },
    ],
  },
  {
    version: "0.58.0",
    title: "IA: comandante seguro e marinha na medida",
    items: [
      { icon: "shield_person", title: "Comandante (ACU) protegido", text: "As obras do jogo mandavam o comandante construir extratores, defesas e estaleiros longe da base, onde ele morria. Agora essas obras ficam só com os engenheiros. Se mesmo assim o comandante passar de 100 unidades da base, ele volta e um engenheiro termina a obra no lugar dele; a fábrica faz um engenheiro novo se não houver nenhum livre. Depois de duas vezes, o comandante sai das obras do jogo e fica guardando a base. A estratégia Pressão com o comandante agora só o leva até a frente da base.", page: "mods" },
      { icon: "sailing", title: "Menos navios", text: "Só um estaleiro por base e metade do orçamento naval. Navios contra-atacando só quando os batedores viram uma marinha inimiga, e só o suficiente para enfrentá-la. Porto só em mapa com bastante água (ou numa IA que aprendeu a usar o mar). Com pouca água, a personalidade naval vira equilibrada e a estratégia Domínio naval quase não aparece.", page: "mods" },
    ],
  },
  {
    version: "0.57.0",
    title: "Alsyper Adaptador: a IA que evolui com você e com o mapa",
    items: [
      { icon: "psychology", title: "Alsyper Adaptador", text: "O centro da IA agora são nove genes (agressão, paciência, expansão, defesa, reconhecimento, saques, tecnologia, aviação e marinha). Eles começam do que ela aprendeu nas partidas anteriores (por mapa e em geral), mudam um pouco a cada partida e se ajustam durante o jogo: ataques que falham, o que mata as unidades dela, o seu estilo, o mapa, a economia e os bairros perdidos. Cada mudança aparece no diário com o motivo. Cada vitória sua deixa a próxima IA um pouco mais forte.", page: "mods" },
      { icon: "travel_explore", title: "Joga sem ver o mapa, como um jogador", text: "A IA só sabe o que viu: no começo avisa que não vê o mapa inteiro e manda um avião (ou uma unidade rápida) até a sua base, e volta a olhar de tempos em tempos. O que ela pesquisa e produz contra você vem do que os batedores viram. Com o mapa todo revelado, ela vê tudo como você.", page: "mods" },
      { icon: "strategy", title: "25 estratégias", text: "Escolhe duas estratégias por vez entre 25 (expansão rápida, domínio econômico, supremacia aérea, defesa fortificada, experimentais, pressão com o comandante, domínio naval, ataques simultâneos, pressão econômica, flancos, artilharia de longo alcance, defesa antinuclear, proteção de engenheiros, coordenação em equipe e outras) e troca quando o jogo muda.", page: "mods" },
      { icon: "swords", title: "Táticas novas", text: "Ataca na hora certa (quando o seu exército acabou de perder ou está longe de casa), emboscada escondida ao lado do caminho que você usa, isca antes do ataque principal, artilharia derrubando escudos primeiro, extratores tomados viram dela, recolhe destroços, caças patrulham entre os bairros, bombardeiros voltam aos seus pontos fracos, veteranos voltam mais cedo para casa, engenheiros fogem de inimigos e o comandante avança com o exército no começo.", page: "mods" },
      { icon: "science", title: "Pesquisa, experimentais e mísseis", text: "Pesquisa com plano (pela personalidade e pelos genes), melhorias do comandante na hora certa (blindagem quando é atacado, armas quando avança), corrida de experimental (destrói a sua fábrica ou corre para fazer o dela), defesa antinuclear quando você tem míssil, míssil nuclear quando está ganhando no fim do jogo, conversor de massa e segunda linha de torres entre os bastiões e a base.", page: "mods" },
      { icon: "tune", title: "Novas opções no launcher", text: "Nível Mestre (pensa a cada 2 segundos), personalidades Engenheira, Relâmpago e Experimental, controles do Alsyper (agressividade, bairros, aviação, marinha), modo treino com dicas na tela, a IA falando durante a partida e, no cartão \"O que a IA aprendeu\", os genes e o resultado das últimas partidas.", page: "mods" },
    ],
  },
  {
    version: "0.56.0",
    title: "IA estrategista: formações, duas frentes, cerco, previsão de ataque e mapinha no painel",
    items: [
      { icon: "account_tree", title: "Bairros com função", text: "Além de bastiões, oficinas e retaguarda, a IA faz uma forja para experimentais atrás de escudos (depois dos 10 minutos) e portos com estaleiros na costa. Bastião numa passagem estreita ganha uma linha de três torres atravessando a passagem. Bairro destruído é reconstruído, e o mapa lembra entre partidas onde os bairros aguentaram e onde caíram.", page: "mods" },
      { icon: "shield", title: "Base que se protege e economia que se ajusta", text: "Escudos sobre os blocos de fábricas (dois nos maiores), antiaéreo espalhado entre a base e os bairros quando o inimigo tem aviação, mais uma fábrica quando a massa sobra e geradores quando falta energia. Com ilhas por perto, um engenheiro vai de avião começar um bairro lá.", page: "mods" },
      { icon: "groups", title: "Exército organizado", text: "Formação no ataque: tanques na frente, artilharia atirando de trás e antiaéreo escoltando a linha de frente. Exército grande ataca em duas frentes ao mesmo tempo. Cerco: prefere os extratores longe da base inimiga antes do ataque final. O exército se junta na frente do bastião e recua para trás das torres dele. Experimental sai com escolta antiaérea.", page: "mods" },
      { icon: "visibility", title: "Lê o jogo", text: "Vê um exército inimigo se juntando e andando para um dos seus lugares e espera na frente dele. Sabe o que está matando as unidades dela (aviação, torres ou tropas) e responde com antiaéreo ou artilharia. O batedor passa pelas áreas de expansão do mapa. IAs aliadas dividem o território, atacam junto com o aliado humano e vão ajudar quando ele é atacado.", page: "mods" },
      { icon: "map", title: "Painel com mapinha, placar e diário", text: "O painel da IA (F4) ganhou um mapinha com a casa e os bairros de cada IA, onde o exército está atacando e onde ela espera o seu ataque, o placar da partida (ataques, vitórias, recuos, defesas, cercos, bairros prontos e perdidos) e um diário com o que ela fez, com o horário.", page: "mods" },
    ],
  },
  {
    version: "0.55.0",
    title: "IA que ocupa o território: bairros em volta da base e base com ruas",
    items: [
      { icon: "domain", title: "Bairros em volta da base principal", text: "Na Partida, a IA não fica mais com uma base só e uma secundária: planeja de 5 a 8 bairros em volta da base principal e constrói um por um. Bastiões virados para o inimigo (torres, antiaéreo, escudo, artilharia e uma fábrica), oficinas nos lados (fábricas de terra e ar, energia) e uma retaguarda com energia, pesquisa e radar.", page: "mods" },
      { icon: "terrain", title: "Escolhe o terreno", text: "Cada bairro vai para chão plano e seco, dentro do território da própria IA (mais perto da casa dela que da de qualquer outro), onde ela ainda não construiu nada. Os bastiões preferem passagens estreitas e terreno alto na direção do inimigo, e os bairros perto das expansões e dos pontos de defesa do mapa ganham prioridade. Não constrói onde há inimigos por perto.", page: "mods" },
      { icon: "grid_view", title: "Base com ruas", text: "A base principal e as expansões do jogo deixavam todos os prédios grudados num quadrado de 60 × 60. Agora a base cresce do centro para fora com uma rua entre os prédios, ocupando uma área cerca de 5 vezes maior: as fábricas ficam espalhadas e as unidades saem sem engarrafar.", page: "mods" },
      { icon: "engineering", title: "Engenheiros próprios e painel", text: "A IA separa alguns engenheiros só para os bairros (e pede mais às fábricas), então a economia do jogo continua crescendo ao mesmo tempo. O painel da IA (F4) mostra quantos bairros estão prontos e qual está sendo construído. O mod da IA é montado de novo sozinho ao abrir o launcher.", page: "mods" },
    ],
  },
  {
    version: "0.54.0",
    title: "Editor de mapas: pincéis sem travar, copiar e colar, simetria, peças e Raio-X",
    items: [
      { icon: "speed", title: "Pincéis sem travar", text: "O pincel de relevo e o pincel de textura do chão não travam mais ao começar a pintar: cada pincelada refaz só a área pintada (antes refazia o mapa inteiro), a prévia 3D atualiza no máximo uma vez por quadro e o que é caro (texturas automáticas, imagens 2D) espera o fim do traço.", page: "create" },
      { icon: "widgets", title: "Peças, decoração natural e prévia da IA", text: "Peças prontas para colocar com um clique (expansões, platô com massa, cratera, desfiladeiro, lago com ilha) e as suas, guardadas a partir da seleção. Decorar Natural põe árvores no chão plano e pedras nas encostas. A camada Marcadores da IA mostra antes de gerar onde a IA vai andar, expandir e lutar, e o Raio-X aponta a massa disputada entre bases rivais.", page: "create" },
      { icon: "content_paste", title: "Copiar, colar e simetria na hora", text: "Ctrl+C e Ctrl+V copiam bases, massa, formas e decorações e colam onde o mouse está, até em outro mapa. Aplicar simetria (Ctrl+M) repete o que você já colocou nos outros lados, só onde falta par; a validação avisa o que ficou sem par. Encaixe na grade (N), Selecionar iguais e Inverter seleção.", page: "create" },
      { icon: "gesture", title: "Rios e serras editáveis ponto a ponto", text: "Selecione um rio, serra, cânion ou caminho e arraste os pontos para mudar o desenho; Alt+clique põe um ponto novo. Botões para suavizar a curva, simplificar e inverter o sentido.", page: "create" },
      { icon: "grid_view", title: "Bases e decorações em modelos prontos", text: "Distribuir bases coloca as bases em círculo, nos cantos, frente a frente ou lado a lado, com a simetria e os times certos e o chão aplainado. Decorações em Fileira (cercas, muros) e Preencher área, e Tirar só o modelo escolhido.", page: "create" },
      { icon: "query_stats", title: "Raio-X e camada de construção", text: "O Raio-X compara o seu mapa com os mapas competitivos (chão plano, níveis, paredões, massa por jogador e onde ela fica) e diz o que fazer. A camada Construção mostra onde cabe prédio, onde só passa e os paredões, com curvas de nível. Exporta o relevo e o mapa em PNG e liga/desliga os marcadores da IA.", page: "create" },
    ],
  },
  {
    version: "0.53.0",
    title: "Gerador de mundos no estilo dos mapas competitivos",
    items: [
      { icon: "stairs", title: "Mapas no estilo competitivo", text: "O gerador de mundos aprendeu com 20 mapas competitivos feitos à mão: platôs planos em vários níveis com paredões curtos e rampas onde passam os caminhos (opção Degraus), moldura que cerca a área de jogo com um abismo, e massa solta espalhada pelo mapa inteiro (cerca de 10 por jogador, além das 4 da base).", page: "create" },
      { icon: "auto_awesome", title: "4 estilos novos", text: "Platôs em degraus, Arena emoldurada, Cânions ramificados e Rios gêmeos. Medidos do mesmo jeito que os mapas feitos à mão: cerca de 2/3 do mapa plano, em 3 a 5 níveis, e uns 100 pontos de massa num mapa de 8 jogadores. Também dá para pedir em Descreva o mapa: \"competitivo\", \"degraus\", \"moldura\", \"massa espalhada\".", page: "create" },
      { icon: "smart_toy", title: "Marcadores para a IA", text: "Todo mapa montado pelo Estúdio sai com os marcadores que a IA do jogo usa, como nos mapas feitos à mão: caminhos por terra e pelo ar, áreas de expansão nos pontos de massa, pontos de defesa e de encontro, zonas de combate, alvos de ataque e um lugar protegido para experimentais atrás de cada base.", page: "create" },
      { icon: "waves", title: "Rios com muitos jogadores", text: "Com 8 jogadores ou mais, os rios, cânions e serras não eram criados (não cabiam longe das bases). Agora passam entre as fileiras de bases, como nos mapas feitos à mão.", page: "create" },
    ],
  },
  {
    version: "0.52.0",
    title: "HUD nova, sem nevasca e minigames melhores",
    items: [
      { icon: "palette", title: "HUD nova de verdade", text: "A HUD das partidas foi redesenhada do zero: vidro grafite (sem o azul do jogo) com listras leves, faixa na sua cor em cima dos painéis, colchetes acesos nos cantos e botões que se enchem da cor ao passar o mouse e quando ativos. Sombras e degradês ficam escuros, sem contorno. O menu da partida segue o mesmo visual.", page: "home" },
      { icon: "ac_unit", title: "Sem nevasca nas partidas normais", text: "Um mod de teste do clima de versões antigas (cp clima teste) punha nevasca em toda partida, mesmo criada pelo jogo. O launcher agora desliga esse mod sozinho em todos os perfis.", page: "home" },
      { icon: "flag", title: "Rei da Colina: o tempo soma", text: "O tempo na colina agora soma (perder a colina não zera o seu tempo): o primeiro time a chegar na meta vira o rei e todos os outros exércitos são destruídos. A colina paga recursos a quem a segura, há avisos em 50, 75 e 90%, contagem regressiva nos 10 segundos finais e aviso 30 segundos antes de ela mudar de lugar. O placar não mostra mais linhas antigas.", page: "home" },
      { icon: "celebration", title: "Minigames mais divertidos", text: "Em todos os modos: Primeiro sangue e Massacre (bônus para quem destrói 15 unidades em 10 segundos). Dominação, Guerra Total e Projeto Supremo ganham o Ponto Dourado (vale o triplo por 1 minuto). Quem fica muito para trás recebe reforços. Escolta avisa quando um VIP está em perigo, e Caça ao Tesouro tem caixas douradas que valem dobrado.", page: "home" },
    ],
  },
  {
    version: "0.51.0",
    title: "Partida grande no jogo com clima e todos os mapas",
    items: [
      { icon: "palette", title: "HUD e menu da partida com o estilo novo de verdade", text: "A HUD nova e o menu da partida (Continuar, Opções, Fim de jogo) não apareciam com as Texturas HD ligadas: elas eram montadas depois e cobriam tudo com as originais. Agora a tela inicial é montada por último e pinta as versões em HD.", page: "bigmatch" },
      { icon: "view_module", title: "Painel da Partida grande renovado", text: "Criar partidas grandes voltou a funcionar: o painel saiu da sala de Criar jogo (onde os botões não respondiam) e fica ao lado do submenu Batalha, com os mapas em miniatura com nome e bases (até 36, os maiores primeiro), as escolhas em duas colunas e a seção CLIMA. O que está escolhido fica aceso, e o botão de começar fica num grupo separado para nada começar sem você clicar.", page: "bigmatch" },
      { icon: "cloud", title: "Clima escolhido dentro do jogo", text: "Chuva, tempestade, neve, neblina ou areia direto no painel. Como o clima é montado para o mapa, o jogo fecha e o launcher abre de novo direto na partida com o clima (cerca de 1 minuto). Se o mesmo clima e mapa já estiverem montados, começa na hora.", page: "bigmatch" },
      { icon: "groups", title: "Sala com amigos que funciona", text: "O botão Sala com amigos (no painel e em Multijogador) agora abre a sala do launcher com as escolhas do jogo: lista de quem está, IAs nas vagas livres, convite e IP/LAN, e o jogo de todos abre junto. Entrar numa sala abre a tela de colar o convite.", page: "bigmatch" },
    ],
  },
  {
    version: "0.50.0",
    title: "HUD nova, cores no jogo e sala com amigos",
    items: [
      { icon: "palette", title: "HUD das partidas no estilo do menu", text: "A HUD das partidas (barra de cima, recursos, construção, fila, seleção, pesquisa e upgrades, placar, bate-papo e menu da partida) ganha a mesma cor e o mesmo acabamento da tela inicial: painéis mais escuros e nítidos e destaques na sua cor. Ícones com cor de significado ficam como no jogo.", page: "settings" },
      { icon: "tune", title: "Cor e HUD nas Opções do jogo", text: "Em Opções → Vídeo: Cor da interface (7 cores) e Estilo da HUD (nova ou original). O launcher aplica na próxima vez que o jogo abrir por ele, nos menus e na HUD juntos.", page: "settings" },
      { icon: "groups", title: "Sala com amigos dentro do jogo", text: "A sala da partida grande com amigos agora é uma sala de verdade dentro do jogo: cada jogador escolhe facção, cor (sem repetir) e time, todos veem a mesma lista e o anfitrião começa. Abra em Multijogador → Sala com amigos: abrir, ou entre em Sala com amigos: entrar; depois de um convite do launcher aparece Entrar na sala de quem convidou.", page: "settings" },
      { icon: "sports_esports", title: "Sala original com os mods iguais", text: "Depois de entrar num convite, os mods ficam iguais aos de quem convidou, então vocês também podem usar a sala original do jogo (até 8): Multijogador → Criar partida → Somente amigos e convite pela Steam.", page: "settings" },
    ],
  },
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
