# CommandProject

Launcher, gerenciador e hub de mods para **Supreme Commander 2**. Instale, atualize, organize e
crie mods sem mexer à mão na pasta do jogo, e encontre gente para jogar com os mesmos arquivos.

![Início](docs/screenshots/inicio.png)

## O que ele faz

**Tudo local**: configurações, projetos, mapas, tropas, texturas e ícones ficam em arquivos no seu
computador (sem banco de dados, sem conta e sem nuvem). O **Modo local** (Sistema → Configurações)
desliga até o que é opcional e usa a rede: hub, servidor da comunidade e busca de atualizações.

**Áreas** (trilho da esquerda, estilo painel de comando): Início · Arquivos · Mapas · Tropas ·
Modelos · Ícones · Mods · Rede · Sistema. O visual **Comando** (painéis táticos, botões chanfrados,
cor da facção UEF/Cybran/Illuminate) é arte própria do launcher; o visual **Clássico** continua
disponível em Sistema → Visual.

**Arquivos locais** ([detalhes](docs/arquivos-locais.md))
- Espaço usado por tipo (projetos, lixeira, cópias, biblioteca, originais do jogo, cache).
- **Cópias de segurança** `.zip` dos projetos: manual, "salvar em…" e **automática** (a cada N dias,
  guarda as 5 mais recentes). Restaurar cria projetos novos: nada existente é substituído.
- **Lixeira** de projetos com restauração e **conferência dos arquivos**: um documento danificado é
  recuperado do salvamento automático ou da versão anterior (o danificado fica guardado).

**Tela inicial**
- Uma unidade do seu jogo em 3D, pintada com as **cores da facção** como no jogo (azul UEF, vermelho
  Cybran, dourado Illuminate, ou a cor de time que você escolher) e com as partes que brilham acesas,
  girando sobre uma plataforma luminosa (arraste para girar; troque a unidade ou esconda o modelo). O modelo é lido da sua instalação na
  hora de mostrar: o launcher não copia nem distribui arquivos do jogo. Sem o jogo, aparece um robô
  original do CommandProject.
- Card de **Aprimoramentos** (Shaders, Remaster HD, memória) com atalhos para cada um.

**Jogar**
- Encontra o jogo sozinho (bibliotecas da Steam, GOG ou pasta escolhida).
- Botão **Jogar**: aplica o perfil de mods e abre pela Steam (`steam://rungameid/40100`) ou pelo executável.
- **Mods só pelo launcher** (ligado por padrão): os mods entram no jogo só quando ele é aberto pelo
  launcher. Quando o jogo (ou o launcher) fecha, a pasta volta ao original — aberto direto pela
  Steam, o Supreme Commander 2 fica sem mods.

**Gerenciar mods (um "Forge" para o SC2)**
- Importa `.scd`, `.zip` (com vários `.scd` + `mod.json`), pastas soltas (`lua/`, `textures/`… viram um `.scd`)
  ou um **link direto** para um pacote.
- Arraste arquivos para a janela para importar.
- **Perfis** na barra lateral (como instâncias), com liga/desliga e **ordem de carga** por arrastar.
- **Conflitos**: mostra quais arquivos internos cada mod sobrescreve e quem vence.
- Detecta mods instalados à mão e os transforma em mods gerenciados.
- **Trapaças para jogar sozinho** (Mods → Trapaças): massa, energia e pesquisa infinitas, toda a
  pesquisa liberada, modo deus (suas unidades não tomam dano nem morrem), construção até 25× mais
  rápida e, para um desafio, as mesmas trapaças para a IA. Com o **menu dentro do jogo**, uma tecla
  (F3 por padrão, ou o botão "CP" na borda da tela) abre um painel na partida para ligar e desligar
  cada trapaça quando quiser. O mod é montado na hora com os arquivos do seu próprio jogo e só liga
  em partidas com um único jogador humano; em multiplayer se desliga sozinho.
- **IA mais esperta** (Mods → IA esperta), para todas as dificuldades da escaramuça, nível Esperta ou Brutal:
  - **navios em mapas com água**: corrige os construtores de navios (usavam uma chave de prioridade
    que o jogo não lê), todo tipo de IA constrói estaleiro quando há mar perto e a IA naval ganha
    quando a água separa os jogadores;
  - **economia e mini-bases**: mais engenheiros, expansões espalhadas pelo mapa mais cedo e em
    paralelo, mais extratores ao mesmo tempo;
  - **comandante estratégico** (Lua por cima da IA do motor) que assume exército, frota e aviação:
    - junta o exército numa emboscada no caminho da base (passagens estreitas, alto do morro, áreas
      de expansão do mapa) e só ataca com vantagem clara, escolhendo extratores, fábricas e
      artilharia mal defendidos que dá para alcançar; recua para as próprias torres quando perde,
      manda feridos para casa e evita os lugares onde vive perdendo tropas;
    - um ataque de verdade (não um batedor sozinho) faz o exército defender; se o inimigo é forte
      demais, ele volta para casa e fica lá até dar para lutar;
    - **pinça** (metade vem pelo flanco), **distração** (ataque-relâmpago longe do ataque principal),
      **foco de fogo** na unidade mais fraca, **artilharia** atrás da linha, **escolta** de experimentais;
    - **aviação**: caças pela superioridade aérea e escolta, bombardeiros onde não há antiaéreo (e
      um alvo novo quando o antigo cai), gunships apoiando o ataque e caçando experimentais;
    - **comandante (ACU)** que foge ferido e ajuda a defender no começo;
    - **desembarques** com transportes em ilhas e extratores fora do alcance por terra: a tropa
      embarca, voa, desce perto do alvo e luta lá;
    - **pesquisa e reparos** conforme o seu jogo (antiaéreo contra aviões, escudos contra artilharia
      e bombardeiros, artilharia de longo alcance contra defesas, antimíssil contra nuke) e
      engenheiros livres consertando prédios depois da luta;
    - **reconhecimento e contra-produção** (antiaéreo contra aviões, artilharia contra torres, navios
      contra frota);
    - **defesa reativa** (torre ou antiaéreo onde uma expansão é atacada), **posto avançado** com
      fábrica perto da frente e **escudo** sobre a base econômica;
    - **IAs aliadas em equipe** (mesmo alvo, ajuda ao aliado atacado);
    - **personalidades**: Misturadas, Equilibrada, Agressiva, Defensiva, Saqueadora, Naval, Aérea;
    - **dificuldade adaptativa** (pressiona mais quando você está ganhando fácil, segura quando você
      está perdendo feio);
    - **aprende o seu jeito de jogar**: monta um perfil seu (estilo: rush, defensivo, aéreo, naval,
      saqueador, econômico, experimentais; quando você ataca; por onde suas tropas passam; o que você
      ataca; onde você expande) e se adapta — emboscada na rota que você usa, torres onde você
      costuma bater (e em casa antes do seu rush), guarda contra saques, produção contra o seu
      exército, bombardeiros contra fortalezas e experimentais, contra-ataque logo depois de você
      atacar. Jogando sozinho, o perfil fica guardado no `Game.prefs` do próprio jogo, por mapa, e a
      IA começa a partida seguinte já preparada (botão "Esquecer o que aprendeu" no painel);
    - **painel "o que a IA está pensando"** dentro do jogo (tecla F4 por padrão ou botão "IA"), só
      jogando sozinho;
    - **leve e seguro**: uma "foto" do mapa a cada ~2,5 s é compartilhada por todas as IAs (em vez de
      cada uma consultar o mapa centenas de vezes); se o comandante der erro várias vezes seguidas,
      ele devolve as unidades para a IA original do jogo e para, então a IA nunca fica pior que a
      do jogo.
  Montado com os arquivos de IA do seu jogo (inclusive as cópias da expansão, que são as que o jogo usa).
- **Partida grande** (barra lateral → Partida grande): escaramuça com **quantos jogadores o mapa
  tiver** — 12 contra 12, três times de 5, todos contra todos. Cada base vira você, uma IA (Fácil,
  Normal, Difícil ou Trapaceira) ou fica vazia, com time e facção à escolha; os times se dividem
  sozinhos pelo lado do mapa ou pela ordem das bases, e clicar numa base da prévia põe você nela.
  A prévia mostra o **terreno do mapa** (o minimapa do jogo) com as bases por cima, e a lista de
  mapas tem uma miniatura de cada um. Até **32 jogadores** por partida (o limite de exércitos do
  motor do jogo; os civis do mapa ficam de fora quando não cabem; em mapas acima de 2560, menos,
  pela memória do jogo: 16 em 4096) e até um time por base
  (24 bases, até 24 times), com **32 cores de exército** (as 10 do jogo e mais 22
  só nas partidas grandes): **cada jogador com uma cor diferente, mesmo no mesmo time** (padrão), ou
  uma cor por time; cores já usadas por outra base aparecem bloqueadas na escolha à mão.
  Regras: todas as da escaramuça normal — tipo de vitória, limite de unidades (até 2000), visão do
  mapa (inclusive **visão total, sem névoa**), velocidade, tempo sem ataques, civis, base montada,
  posições fixas ou sorteadas (dentro de cada time ou entre todos), limite de quem morre passando
  para o time, trapaças do console do jogo e as **14 restrições de unidades** do lobby (sem aviões,
  sem nucleares, sem experimentais, sem pesquisa com tudo liberado…). O lobby do jogo é em Flash e só tem 8 vagas, então o launcher abre o jogo direto na
  partida (`/map` + `/cpmatch`); o mod que faz isso é montado na hora com o `SinglePlayerLaunch.lua`
  e o `GameSessionManager.lua` do seu jogo; ele só fica ligado nas partidas grandes (o Jogar comum
  o desliga), então o lobby do jogo continua igual.
- **Partida grande com amigos — sala de convite** (experimental; Partida grande → Jogar com amigos):
  marque bases como **Amigo**, escolha como os amigos vão se conectar (mesma rede, Radmin VPN,
  ZeroTier, Hamachi, Tailscale ou internet com a porta aberta) e clique em **Abrir sala e criar
  convite**. O launcher do anfitrião vira um servidor pequeno, só para quem tem o código (sem
  servidor dedicado, banco de dados nem conta). Quem cola o convite (`CPM2.…`, **cifrado: o IP não
  aparece nele nem na tela**) entra na sala e **baixa sozinho, do PC do anfitrião, os mods que mudam
  a partida e o mapa personalizado** (com o hash de cada arquivo conferido); os mods ficam num perfil
  "Partida com amigos" (os perfis da pessoa não mudam, e ao sair da sala volta o de antes). Na sala:
  quem está, quem já baixou tudo, **chat** e **chat de voz** (microfone aberto com detector de voz
  ou apertar para falar com uma tecla que funciona dentro do jogo; mudo com Alt+M; volume e
  silenciar cada amigo; Opus pelo WebCodecs, com cancelamento de eco), que passa pelo launcher do
  anfitrião. O anfitrião clica em **Começar** e o jogo de todo mundo abre direto na partida, que liga
  os jogos pela rede do próprio jogo (`lobbyComm`: `HostGame`, `JoinGame`, `LaunchGame`), com mais
  de 8 jogadores. A sala usa a porta TCP escolhida (padrão 15000) e a partida a UDP do mesmo número.
- **Som do clima dentro do jogo**: o vento das alturas e o mar dos próprios mapas do jogo (de
  preferência os do mapa da partida), tocados como som 3D seguindo a câmera de cada jogador e
  parando nas calmarias do clima que muda; numa partida com amigos, cada um tem o clima onde olha.
- **Climas** (Partida grande → Clima): **chuva**, **tempestade**, **nevasca**, **neblina** ou
  **tempestade de areia** na partida, com a quantidade à escolha, e a opção **clima que muda**: o
  clima vai e volta durante a partida (períodos fortes, calmarias e às vezes céu limpo, sem raios na
  calmaria), com o mesmo roteiro em todos os computadores. A neblina (bancos de névoa baixos e lentos)
  e a areia (fios de areia e nuvens de poeira rente ao chão, com vento forte) não mudam o chão nem as
  unidades. Tudo acontece no mundo, não na tela: as gotas e os flocos caem de cima do
  chão, e o terreno, os prédios e as unidades escondem cada um onde ele chega; a chuva faz anéis e
  respingos no chão e na água. A interface do jogo informa à simulação o pedaço do mapa que a câmera
  mostra (`SimCallback 'CPWeather'`), e um conjunto fixo de emissores (até 180) segue a câmera numa
  grade que engrossa quando ela sobe, com o **mesmo custo em qualquer zoom e em qualquer tamanho de
  mapa**. Todas as células caem **na mesma quantidade** (sem quadrados com e sem chuva), o clima
  **começa fraco e engrossa** no primeiro minuto e depois varia devagar; ao mudar o zoom, a chuva
  antiga termina de cair enquanto a nova chega. Os anéis no chão ficam na altura de cada pedaço do
  terreno (sem manchas sem pingo nos desníveis).
  - **Chão**: na chuva, a mesma textura do mapa **molhada** conforme o material (terra e areia
    escurecem muito, rocha e grama menos, piso de metal e concreto quase não escurece mas vira
    espelho, com água nas juntas); na nevasca, **coberto de neve** mantendo o relevo, com neve só nas
    partes altas das rochas e as juntas dos pisos aparecendo. Nada de manchas novas, que se repetiriam
    a cada ladrilho.
  - **Unidades, prédios e objetos do mapa** (mod "Climas: unidades e prédios", montado uma vez por
    clima): pela malha de cada modelo, a **neve acumula só nas superfícies viradas para cima**
    (telhados, topos), fosca, com um leve tom de geada no resto; na chuva as partes expostas ficam
    **molhadas** (mais brilho; tinta e borracha escurecem, metal liso só brilha). A cor do time e as
    luzes nunca mudam.
  - **Água**: na chuva e, mais ainda, na tempestade, ondas mais fundas e ondinhas da chuva.
  - **Raios e trovões**: raros e em lugares sorteados (metade perto de onde você olha, às vezes dois
    seguidos), com intervalos sem ritmo. O **trovão é um som do próprio jogo tocado no lugar do raio**
    (som 3D, com a direção e a distância) e chega depois do clarão, mais tarde quanto mais longe.
  - **Som**: o jogo não tem som de chuva nem de vento forte; o launcher toca um som baixo de chuva e
    vento (ou o vento da nevasca) que **varia o tempo todo**, com volume e botão de ouvir.
  - A textura não muda durante a partida (limite do motor): o chão e os modelos já começam molhados ou
    nevados, e o que muda aos poucos é a quantidade de chuva e de neve caindo.
  - O mod é montado para cada mapa e clima com os arquivos do seu jogo e dos mods ligados e fica
    ligado só nessa partida; a primeira vez leva alguns segundos (os modelos, cerca de um minuto).
- **Forja** (carregador de mods, como o Forge do Minecraft): mods com código Lua que **não editam
  arquivos do jogo**. Cada mod tem `forja/<id>/` com `mod.json` (versão, dependências, ordem de carga,
  conflitos e opções) e `sim.lua`, `ui.lua` e `blueprints.lua`. A cada aplicar, o launcher confere
  dependências e conflitos, ordena os mods e monta o mod `cp-forja` com os arquivos do jogo como
  ficam com os outros mods ligados, acrescentando o motor da Forja: eventos (início da partida,
  unidade criada, construída, danificada, morta, capturada), comandos da interface para a simulação e
  mensagens de volta (sincronizado no multiplayer), painéis e teclas, ajudas para blueprints
  (`EachUnit`, `Scale`, `Merge`, `Clone`), APIs entre mods (`Export`/`Use`) e opções ajustadas na tela
  **Forja** do launcher. Cada mod roda isolado: um erro não derruba os outros nem o jogo, e o painel
  **F8** na partida mostra os mods e os erros. `cp forja new|check|pack|status|option` na linha de
  comando; guia completo em <https://commandproject.gitbook.io/forja/> e exemplo em `examples/forja-exemplo`.
  - **Editor de mods** na tela da Forja: os arquivos do mod, autocompletar da API da Forja, ajuda ao
    passar o mouse e avisos do que não existe no **Lua 5.0** do jogo (`#`, `%`, `gmatch`, `!=`…).
    O autocompletar também conhece as **461 funções e 51 tabelas globais** da simulação do jogo
    (`IssueMove`, `CreateLightParticle`, `ArmyIsOutOfGame`…).
    Com **Recarregar ao salvar**, cada Ctrl+S monta o mod de novo e substitui o instalado.
  - **Modelos** para começar: completo, balanceamento (vida, custo, velocidade e alcance com opções),
    painel, regra de jogo e biblioteca (`mod.Export`).
  - **Erros de sintaxe de verdade** enquanto digita (a linha exata do `end` ou parêntese que falta),
    **trechos prontos** (menu Inserir: eventos, timers, comandos, painéis, blueprints), **abas** de
    arquivos e **busca em todos os arquivos** (Ctrl+Shift+F), **formulário do mod.json** (nome,
    versão, dependências e as opções do launcher sem mexer no JSON), **unidades do jogo** para
    procurar e inserir o id certo, **Testar no jogo** (salva, recarrega e abre uma partida rápida
    contra uma IA fácil), **erros da última partida** com arquivo e linha (clicar abre no lugar) e
    **Empacotar** (o `.scd` e a entrada pronta para um índice do Hub).
  - No **Hub**, mods da Forja (tag `forja`) têm selo e filtro, e as dependências são instaladas junto.
- **Busca em tudo** (`Ctrl+K`): páginas, ações, perfis, mods, projetos, mapas da Partida grande e
  seções das Configurações, com ou sem acento.
- **Novidades**: depois de atualizar, uma janela mostra o que mudou (e pela busca, "Novidades").
- **Arte do jogo no launcher** (Configurações → Visual): cabeçalhos e janelas com as imagens dos
  menus do próprio SC2, lidas da sua instalação (nada do jogo vem com o launcher).

**Recursos do launcher**
- Tela própria (**Recursos**, na barra lateral) com o que já vem com o CommandProject: Primeira Pessoa,
  IA esperta, Otimização, Partida grande, Climas, Remaster HD, Menu moderno e o jogo em português.
  Não precisa instalar: é só ligar (na primeira vez o recurso é montado no seu PC com os arquivos do
  jogo, sem baixar nada), e **Atualizar todos** remonta com as opções salvas. Esses recursos não
  aparecem na aba **Mods**, que mostra só os seus mods e as **Trapaças**.
- **Primeira Pessoa** (novo): selecione uma unidade e aperte **F5** — a câmera do motor do jogo
  fica colada nela, na altura dela, e vira junto quando ela anda; F5 de novo, terceira pessoa
  atrás da unidade, seguindo pelo terreno (gira e dá zoom com os controles normais); com várias
  unidades, **câmera de comando** acima e atrás da formação. Enquanto a câmera está ligada,
  **W A S D** andam para onde a câmera olha (a unidade ou o grupo todo), **E** atira no que está sob
  o mouse, **Q** para, **R** troca 1ª/3ª pessoa e **Esc** volta à câmera estratégica (com as teclas
  originais de volta). Ordens com o botão direito, habilidades, o menu de construção e o
  posicionamento de prédios continuam os do jogo em qualquer câmera — construtores constroem em
  primeira pessoa. Sem nada selecionado, F5 continua com a função original. Mira e painel com a
  unidade, a vida e as teclas. As ordens passam pela simulação e só valem para unidades do
  próprio exército (funciona em multiplayer, com todos tendo o mod).
- Loja da comunidade com destaques, filtros por fonte/categoria e ordenação; instala e atualiza com um clique.
- Fontes: o hub do servidor da comunidade e quantos índices JSON extras você quiser.
- Download verificado por **SHA-256 e tamanho** antes de entrar na biblioteca.

**Multiplayer**
- **Salas e chat** dentro do launcher, via servidor da comunidade (`cp-server`): quem hospeda
  anuncia a sala com o código do perfil; quem entra revisa e instala os mods que faltam.
  Salas fechadas com senha, chat geral e chat por sala.
- O SC2 roda em lockstep: todos precisam dos mesmos arquivos. O launcher calcula a
  **assinatura da pasta** (ex.: `7F3A-91C2-0B5E`) para comparar antes do lobby.
- **Código de perfil** (`CP1-…`): seu amigo cola e fica com exatamente os mesmos mods.
- A partida em si continua no lobby da Steam, que o launcher abre para você.
- **Jogar por IP, sem a Steam** (aba *Por IP*): partidas privadas pela rede local, por VPN
  (Radmin, ZeroTier, Hamachi, Tailscale) ou pela internet com a porta aberta, usando o
  [SC2-Proxima](https://github.com/Rackover/sc2-proxima) (Rackover, GPL-3.0). O launcher baixa o
  lançamento oficial quando você pede, coloca o `steam_api.dll` dele só enquanto o jogo aberto pelo
  launcher está rodando e devolve o original quando ele fecha — pela Steam, nada muda.
  Quem hospeda vê os endereços para mandar (o da internet fica escondido até você pedir); quem
  entra cola o endereço e o launcher copia e abre o jogo.
- **Prender o mouse na janela do jogo** (Configurações → Jogo): no modo janela, o mouse não sai
  da janela enquanto o jogo está na frente; Alt+Tab solta.

**Estúdio de criação**
- **Arquivos do jogo**: navega por todos os `.scd` (sempre os originais), com prévia de Lua,
  texturas DDS e modelos 3D `.scm`; exporta para PNG/OBJ/GLB. Lua em bytecode é mostrado pela
  versão em texto de `uncompiled_lua.scd` quando ela existe.
- **Projetos**: copia arquivos do jogo para o seu mod e edita:
  - **Lua** com realce, autocompletar e checagem de blocos;
  - **texturas** com **pintor embutido** (pincel, borracha, balde, conta-gotas, desfazer), ajuste
    de cor e importação de PNG mantendo formato DXT e mipmaps;
  - **modelos** com visualizador 3D e importação de OBJ com **rigging automático** (cada vértice
    segue o osso mais próximo do modelo original) ou preso a um osso escolhido.
  Gera o mod direto na biblioteca e exporta o pacote pronto para o hub.
- **Skin de interface**: recolore a HUD inteira em lote (matiz, saturação, brilho, contraste,
  tingimento), com prévia antes/depois. Gera um mod só com as texturas alteradas.
- **Mapas**: integra o [SC2 Map Toolkit](https://github.com/plutonics72/supcom2-map-toolkit).
  Editor em **3D** (relevo do terreno com a textura do jogo, água e câmera livre) ou 2D. Coloque bases
  e **pontos de extração de massa**, esculpa morros, vales, planaltos, áreas planas e rampas,
  desenhe passagens sobre a água, ligue a borda rochosa e ajuste a economia. Tudo com desfazer
  (Ctrl+Z). O toolkit verifica se todo ponto é navegável e se as bases se alcançam antes de gerar.
  - **Decorações**: árvores, pedras, prédios, caixas e restos de unidades de **qualquer mapa do jogo**
    (catálogo com busca e prévia 3D). Clique para colocar uma ou arraste para espalhar um bosque, com
    giro e tamanho variados; a ferramenta **Tirar decoração** limpa as do terreno original.
  - **Texturas do chão**: troca cada camada (grama, terra, rocha…) por uma de outro mapa, como neve,
    areia ou lava, com miniaturas das texturas reais.

**Menu moderno (repaginada nos menus do jogo)**
- Mod do próprio launcher, gerado no seu computador a partir dos arquivos do jogo: menu principal,
  opções, escaramuça, salas e resumo da partida com as cores do launcher. Personalize com estilos
  prontos (Launcher, Neon, Carmesim, Grafite, Vidro, Original + nitidez), cor de destaque e de
  passar o mouse, escurecer/tingir fundos, opacidade dos painéis, brilho dos botões e nitidez.
  A fonte Roboto no lugar da MagistralTT é opcional (experimental). Cores de facção e de time ficam
  intactas. Liga e desliga na biblioteca como qualquer mod; não afeta o multiplayer.
- Se o jogo fechar com erro logo depois de abrir, o launcher avisa e oferece desligar os mods que
  estavam ativos naquela partida.
- O jogo só aceita um `.scd` de mod a mais no índice de arquivos (com dois, fecha ao abrir). Quando
  mais de um mod substitui arquivos do jogo, o maior (ex.: Texturas HD) fica como `.scd` e os outros
  (ex.: Menu moderno) são colocados como arquivos soltos na pasta do jogo, que o launcher remove ao
  desligar o mod.
- A tela inicial do launcher tem a aba **Mods**, com o que está ligado no perfil e atalho para desligar.

**Shaders (deixa o jogo mais bonito)**
- Mod de pós-processamento próprio para o ReShade (DirectX 9): anti-serrilhado, nitidez adaptativa,
  relevo no terreno, bloom nas explosões e correção de cor. Presets **Natural**, **Vívido** e **Cinemático**.
- O launcher instala o ReShade oficial com um clique (assinatura conferida) e troca o preset; é só
  visual e não dessincroniza o multiplayer. A faixa "Pressione Home para iniciar o tutorial" do ReShade some
  sozinha (o launcher marca o tutorial como visto). Detalhes em [resources/shaders](resources/shaders/README.md).

**Remaster HD (texturas com mais resolução, nitidez, cor e relevo)**
- No Estúdio, gera um mod a partir das texturas **originais do seu jogo**: tira os blocos da compressão
  DXT, amplia 2x ou 4x (Lanczos com anti-halo + retroprojeção, que recupera bordas sem inventar
  detalhes) e aplica nitidez adaptativa. Recomprime no mesmo formato, com mipmaps.
- Trata cada tipo de textura do jeito certo: mapas de normal são renormalizados, máscaras não ganham
  nitidez, tabelas de cor/fontes/cubemaps não mudam, e a interface fica em "só nitidez" (o jogo
  desenha muitas imagens dela no tamanho da própria textura).
- Calcula antes quanto de memória de vídeo as texturas vão ocupar e ajusta sozinho para caber.
- **Remaster** (gerador 3.0, ligado por padrão, de 0 a 150%): fiel ao visual do jogo, só mais rico,
  em três **estilos** (Fiel, Vivo e Cinematográfico), com **força por tipo de superfície** e uma
  **galeria** de prévias (uma textura de cada tipo, antes e depois).
  Contraste local sem halos (o detalhe pintado e o relevo aparecem mais), vivacidade que só reforça
  cores apagadas (cinzas, metal e cor do time ficam como estão), curva em S leve e mapas de normal com
  mais profundidade. Cada tipo de superfície tem a sua dose: chão e água, vegetação e objetos do mapa,
  tropas e prédios, efeitos e interface. Climas e outros mods de textura partem das texturas
  remasterizadas.

**Criar em abas: mapas, tropas e modelos 3D** ([guia](docs/criacao.md))
- Cada projeto abre numa **aba própria** (várias ao mesmo tempo), com salvamento automático,
  recuperação após fechar sem salvar, **versões**, desfazer/refazer e exportação `.cpproj`.
- **Gerador de mundos por semente**: montanhas, cordilheiras, lagos, rios, ilhas, cânions,
  crateras, dunas, florestas, ruínas e destroços, com simetria para 2 a 32 jogadores e passagens
  automáticas entre as bases. Nas **partidas grandes** (mais de 8 jogadores) as bases se espalham pelo
  mapa todo, uma **cordilheira no meio separa os times** (com passagens no centro e dos lados),
  **serras curtas separam as bases vizinhas** e o mapa ganha mais montanhas — as duas opções também
  podem ser ligadas ou desligadas em qualquer mapa. **Massa simétrica** (expansões seguras e disputadas, centro disputado),
  paredões que criam gargalos e galeria de variações. Depois de gerar, tudo continua editável.
- **Mar e ilhas** (estilo do gerador e os modelos "Ilhas no mar aberto" e "Continente e ilhas"): mar
  gigante com **cada base na sua ilha**, **uma ilha por time**, um **continente no meio** ou um
  **arquipélago**; tamanho das ilhas, quantas ilhas neutras pelo mar, recorte da costa (baías,
  cabos e penínsulas), profundidade e a **ligação entre as ilhas** — só pelo mar (guerra naval e
  aérea), bancos de areia rasos ou pontes. As ilhas seguem a simetria do mapa.
- **Assistente do editor de mapas** (aba Assistente):
  - **Esboço → mapa**: desenhe com cores (água, planície, morros, montanha, deserto, planalto,
    abismo), espelhado se quiser, ponha as bases e o desenho vira relevo de verdade, com encostas,
    detalhe e erosão.
  - **Descrever o mapa**: escreva "arquipélago com 6 jogadores, muitos rios e florestas, ligado por
    pontes" (ou em inglês) no gerador de mundo e ele se ajusta sozinho, sem internet.
  - **Relevo de imagem**: um PNG em tons de cinza vira o relevo, com as alturas do preto e do branco.
  - **Pincel de erosão**: chuva cava ravinas e leva terra encosta abaixo só onde você pinta.
  - **Carimbos de terreno**: guarde uma montanha, um vale ou uma ilha e cole em outros lugares (ou
    outros mapas), com tamanho, giro e espelho; a biblioteca de carimbos fica no launcher.
  - **Régua**: distância em linha reta e a pé (desviando de água e encostas) e o tempo de uma tropa
    leve, um tanque, um experimental e um avião.
  - **Equilíbrio**: nota de 0 a 100 comparando a massa perto, a distância até a massa e até o
    inimigo e quantas entradas cada base tem, com os problemas, o tempo de ataque entre as bases e um
    botão que põe a massa que falta nas bases mais pobres.
  - **Câmera do jogo** (a inclinação e o zoom do jogo), **passeio** em volta do mapa e vista de cima.
  - **Linha do tempo**: arraste pelas versões salvas e compare cada uma com o mapa de agora; dá para
    voltar para qualquer uma.
- **Validação do mapa** com correção automática: bases na água/declive/isoladas, massa inacessível,
  em declive ou sobreposta, decorações em cima de bases e massa, distâncias e massa desiguais.
- **Editor de mapas** no estilo de um editor de jogo:
  - **quantas bases quiser** (até 64) e conferência com 2, 3, 4, 5, 6 ou 8 times ou todos contra
    todos; mapas com mais de 8 bases jogam pela Partida grande;
  - abre direto num **mapa em branco** (chão liso de grama), sem escolher terreno, do tamanho que
    quiser: de 512 a **4096** (80 km de lado), de 512 em 512. 512, 1024 e 2048 usam terrenos do
    próprio jogo; os outros tamanhos (os **mapas gigantes**, como 3072 e 4096) redimensionam o
    terreno de 2048 na hora de gerar: relevo, navegação das tropas, colisão, malha do chão, luz,
    água, minimapa e área jogável são refeitos no tamanho novo, e o gerador de mundos põe mais
    montanhas, lagos e rios na proporção da área. Acima de 2048 é experimental (o jogo original
    vai até 2048) e pesa mais. A geração conta as regiões de passagem por trechos de linha (e não
    célula a célula), confere todas as bases com uma única contagem e só monta a malha do chão
    quando ela cabe no jogo: um mapa de 4096 com 32 bases sai em menos de um minuto (antes, perto
    de dez), e um de 2048 em uns 30 segundos;
  - **visual limpo**: a malha do chão (e a colisão) é refeita para o relevo novo, a luz e as
    sombras também, e as decorações originais saem — nada do mapa original aparece por cima;
  - **chão por biomas** (praia, chão, terra, rocha e topo misturados pelo relevo) e **pincel de
    textura** para pintar partes do mapa; **texturas próprias** importadas de .png/.jpg (contínuas,
    com relevo e brilho gerados); **paisagem em volta** do mapa com montanhas;
  - **atmosfera** do mapa (pôr do sol, amanhecer, noite, nublado, neblina densa, deserto, frio
    polar, vulcânico, planeta alienígena) com força ajustável, e **vento** (força e direção): mexe
    na cor do sol e das sombras, da água e da neblina no `info.bdf`, sobre a luz do mapa base;
  - gerador de **mapas de plataformas sobre um abismo** (pontes, torres, fundo de rocha ou mar) e
    **céu** de qualquer mapa do jogo;
  - gerador com **vilas, estradas de terra e plantações**, matas com espécies e chão próprio,
    árvores na beira da água e relevo com o dobro da resolução e detalhe fino;
  - vista 3D com as texturas e o tamanho reais das decorações e do chão, explorador (esconder e
    travar), propriedades;
  - pincel de escultura, formas do terreno, simetria;
  - análise de equilíbrio (território, caminhos e gargalos) e prévia do lobby;
  - decorações com o modelo e a textura reais do jogo, modelos próprios, texturas do chão;
  - *Gerar e jogar* e exportar o `.scd`.
- **Editor de modelos 3D**: formas, importação OBJ/GLB, edição de vértices, grupos que viram ossos,
  materiais com imagem, cor do time e brilho; exporta `.scm` + `.dds` para o jogo, OBJ e GLB.
- **Misturador de 3 tropas**: chassi de uma, torre de outra e arma/cano de uma terceira, com
  modelos, texturas (atlas), animações e ossos combinados e verificados (peças soltas, encaixe,
  ossos das armas).
- **Gerador de texturas** procedural no espaço UV do próprio modelo: camuflagens (floresta,
  digital, estilhaços, listras, urbana), painéis com frestas, grades, escotilhas e rebites, marcações,
  desgaste nas quinas vivas, arranhões, sujeira por altura/frestas, escorridos e poeira. Prévia ao vivo,
  comparação lado a lado, versões, regenerar só uma camada e exportar PNG.
- **Gerador de ícones**: câmera, luz, fundo (painel tático, degradê, transparente), contorno e
  símbolo da função, prévia em 24–64 px e exportação em lote para uma pasta.
- **Verificação de combate e movimento** antes de gerar: tipo de movimento × categorias,
  velocidade/aceleração, colisão × tamanho do modelo, seleção, ossos de cada arma, torre que
  carrega o cano, boca abaixo do chão, alcance × visão, animações (ossos inexistentes, peças que
  esticam ou se soltam, rotações bruscas, laço que não fecha). Erros impedem gerar.
- **Criador de tropas** (experimental): parte de uma unidade do jogo.
  - Edita aparência (pintar direto no modelo, ícone gerado do 3D, assistente de ossos), atributos
    e armas (copiar de outras unidades).
  - Animações: trocar, ou criar numa linha do tempo com prévia ao vivo.
  - Comportamento e fábricas.
  - Comparação de equilíbrio e modelos de função (tanque pesado, artilharia, batedor…).
  - Gera um mod instalável ou um pacote com várias tropas.

**Otimizador incluso** ([detalhes](docs/otimizador.md))
- Monitor de memória/CPU do jogo, prioridade do processo, perfis das opções gráficas do jogo com
  backup, análise dos relatórios de travamento (módulo culpado e dica), conflitos de mods e versão
  do jogo. Opcional, reversível e sem promessa de FPS: você mede antes e depois.
- **Mod de otimização**: limite de FPS escolhido (o jogo vem travado em 100; dá para subir até 240
  em monitores rápidos) e um limite menor nas partidas grandes para sobrar processador para a
  simulação; placa de vídeo dedicada, sem as "otimizações de tela cheia" e sem economia de energia
  do Windows para o jogo; prioridade e modo 4 GB. Não remove nada do jogo e tudo se desfaz.

**Memória do jogo (2 a 4 GB)**
- O SC2 é um programa de 32 bits: sozinho usa até 2 GB, e o máximo possível para ele é 4 GB.
  Em Configurações você escolhe o teto (2, 2,5, 3, 3,5 ou 4 GB). Acima de 2 GB o launcher liga a flag
  *Large Address Aware* no executável (guarda o original e reaplica se a Steam restaurar o arquivo);
  entre 2 e 4 GB, quando o jogo abre, ele entra num *Job Object* do Windows com o limite escolhido.
  A tela mostra a RAM do PC e sugere um valor; as Texturas HD calculam quanto cabe nesse teto.
  (Transformar o jogo em 64 bits de verdade exigiria recompilar o motor, cujo código não é público.)

**Atualizações do app**: avisa quando sai uma versão nova nas Releases do GitHub e atualiza com um
clique (baixa com retomada, confere o SHA-256 publicado pelo GitHub, instala e reabre sozinho).

| | |
|---|---|
| ![Hub](docs/screenshots/hub.png) | ![Multiplayer](docs/screenshots/multiplayer.png) |
| ![Pintor de texturas](docs/screenshots/pintor.png) | ![Mapas](docs/screenshots/mapas.png) |
| ![Shaders](docs/screenshots/shaders.png) | ![Presets: original, Natural, Vívido, Cinemático](docs/screenshots/shaders-presets.jpg) |
| ![Texturas HD](docs/screenshots/texturas-hd.png) | ![Comparação de ampliação](docs/screenshots/texturas-hd-comparacao.jpg) |
| ![Editor de mapas](docs/screenshots/editor-mapa.png) | ![Editor de modelos 3D](docs/screenshots/modelo-3d.png) |
| ![Criador de tropas](docs/screenshots/tropa.png) | ![Desempenho](docs/screenshots/desempenho.png) |
| ![Gerador de mundos](docs/screenshots/gerador.png) | ![Mundo gerado](docs/screenshots/mundo-gerado.png) |
| ![Análise do mapa](docs/screenshots/analise-mapa.png) | ![Linha do tempo de animação](docs/screenshots/tropa-animacao.png) |
| ![Arquivos locais](docs/screenshots/arquivos.png) | ![Gerador de ícones](docs/screenshots/icones.png) |
| ![Gerador de texturas](docs/screenshots/gerador-texturas.png) | ![Ícone de uma tropa](docs/screenshots/gerador-icones.png) |
| ![Misturar 3 tropas](docs/screenshots/misturador.png) | ![Verificação de combate](docs/screenshots/tropa-verificacao.png) |
| ![Validação do mapa](docs/screenshots/validacao-mapa.png) | |

## Segurança dos arquivos do jogo

O motor de implantação (`crates/cp-core/src/deploy.rs`) foi feito para nunca deixar o jogo quebrado:

1. **Linha de base**: na primeira vez, registra nome, tamanho e SHA-256 de cada `.scd`.
2. **Backup endereçado por conteúdo**: antes de substituir um arquivo (ex.: `lua.scd`), o original
   vai para `backups/<sha256>.scd`.
3. **Diário com intenção**: cada operação grava o que vai fazer antes e o resultado depois.
   Se o PC desligar no meio, o launcher termina ou desfaz a operação na próxima abertura.
4. **Cópia atômica**: escreve num temporário e renomeia; nunca existe arquivo pela metade.
5. **Quarentena**: se um arquivo colocado pelo launcher foi editado por fora, ele é guardado em
   `quarantine/` em vez de apagado.
6. **Voltar ao original** restaura a pasta byte a byte (coberto por testes).

## Servidor da comunidade (`cp-server`)

Um único binário em Rust (axum) que oferece salas, chat e o hub de mods. Não precisa de banco de
dados: as salas vivem na memória e o hub é uma pasta.

```bash
cargo run -p cp-server --release           # http://localhost:8787
docker build -f crates/cp-server/Dockerfile -t cp-server .
docker run -p 8787:8787 -v $PWD/hub:/srv/hub -e CP_SERVER_NAME="SC2 Brasil" cp-server
```

| Variável | Para quê |
|---|---|
| `PORT` | porta HTTP (padrão `8787`) |
| `CP_SERVER_NAME`, `CP_MOTD` | nome e recado exibidos no launcher |
| `CP_HUB_DIR` | pasta do hub (`mods/<id>/<versão>/pacote.zip`), veja [server-example](server-example/README.md) |
| `CP_DATA_DIR` | dados do servidor (padrão `data/`) |
| `CP_TRUST_PROXY` | `1` para ler o IP de `X-Forwarded-For` atrás de um proxy reverso |

Rotas: `GET /api/info`, `GET|POST /api/rooms`, `PATCH|DELETE /api/rooms/{id}` (token do dono),
`POST /api/rooms/{id}/join|leave|heartbeat`, `GET /ws` (chat), `GET /hub/index.json`.
Limites embutidos: 3 salas por IP, 6 conexões de chat por IP, 6 mensagens a cada 10 s,
mensagens de até 500 caracteres; salas sem sinal por 2 minutos somem sozinhas.
Coloque um proxy com HTTPS na frente (Caddy, Nginx): o launcher só aceita `https://`, exceto em `localhost`.

## Arquitetura

```
crates/cp-core     núcleo em Rust (sem interface): jogo, .scd, biblioteca, perfis, implantação,
                   conflitos, hub, multiplayer, DDS, SCM, Lua, estúdio, ponte de mapas
crates/cp-cli      `cp`: o mesmo núcleo pela linha de comando
crates/cp-server   servidor da comunidade: salas, chat (WebSocket) e hub
src-tauri          app desktop (Tauri 2): comandos + eventos de progresso
src                interface (React + TypeScript + Vite)
resources/maptk    SC2 Map Toolkit (MIT, sem alterações) + maptk_bridge.py
resources/shaders  shaders do ReShade (CommandProject.fx) e presets
resources/python   Python embutido (baixado no build do Windows)
docs/HUB_API.md    formato do índice do hub e do mod.json
docs/criacao.md    editores de mapa, modelo 3D e tropa (uso, formatos, desenvolvimento)
docs/otimizador.md o que o Otimizador muda e como desfazer
```

A interface roda também no navegador com um backend simulado (`src/lib/mock.ts`), útil para
trabalhar no visual sem o jogo instalado.

## Desenvolvimento

Requisitos: Rust estável, Node 22, Python 3.9+ (para o Estúdio de Mapas) e, no Windows, o
[WebView2](https://developer.microsoft.com/microsoft-edge/webview2/) (já vem no Windows 10/11).

```bash
npm install
npm run tauri dev        # app completo
npm run dev              # só a interface, no navegador, com dados simulados
npm run test:core        # testes do núcleo e do servidor (cargo test)
npm run test:maps        # testa a ponte do toolkit com um "jogo sintético"
npm run tauri build      # instalador NSIS (Windows)
```

O GitHub Actions (`.github/workflows/build.yml`) roda clippy e os testes, baixa o Python embutido
oficial e gera o instalador do Windows; a cada push na `main` publica o release `v<versão>` com o instalador (mude a versão em `package.json`, `src-tauri/tauri.conf.json` e `src-tauri/Cargo.toml` para lançar outra).

### CLI

```bash
cargo run -p cp-cli -- help
cp status | cp import zz_STORM.scd | cp apply | cp purge | cp conflicts | cp fingerprint
cp link https://exemplo.com/zz_mod.scd     # instala de um link direto
cp hub-build hub/ index.json               # gera o índice de uma pasta de hub
cp hd gerar                                # gera o mod Texturas HD
cp 4gb on                                  # liga o modo 4 GB no executável
```

A CLI usa a mesma pasta de dados do app (`%APPDATA%\io.github.riquebitt.commandproject`), ou `CP_DATA`.

## Limitações conhecidas

- **Ordem de montagem**: o launcher assume que o jogo monta os `.scd` em ordem alfabética e o último
  vence (é o que os mods da comunidade usam com os prefixos `_` e `zz_`). Teste numa partida.
- **Modelos `.scm`**: leitura das versões 5 a 7 e escrita da 7. O rigging
  automático copia o osso do vértice original mais próximo, sem misturar pesos; malhas muito
  diferentes do original podem deformar nas animações.
- **Lua compilado**: só dá para editar como texto quando o jogo traz a versão em `uncompiled_lua.scd`.
- **HUD**: a edição é por textura e por Lua (layout em código); ainda não há editor visual de arrastar.
- **Texturas do chão dos mapas**: sem o visual limpo, a troca vale para a camada inteira e o nome
  novo precisa caber no espaço do original. Com o visual limpo, o chão usa as cinco texturas do bioma
  misturadas pelo relevo e pelo pincel (experimental: confirme no jogo); o jogo só mistura texturas
  vizinhas na cadeia (praia → chão → terra → rocha → topo), então pintar "topo" no meio da grama
  passa por terra e rocha na borda da pincelada.
- **Trapaças** (experimental: confirme no jogo): o mod leva versões do `simInit.lua` e do
  `SimCallbacks.lua` do seu jogo e, com o menu, também do `gamemain.lua` e do `UserSync.lua` (o
  código vai dentro desses arquivos, que o jogo já conhece); outro mod que mexa neles entra em
  conflito (veja Conflitos). Ao começar a partida aparece no alto da tela "trapacas ligadas". Os textos do menu ficam sem acento para não depender da fonte do jogo. As unidades criadas viram invencíveis em até 1 s.
- **Partida grande** (experimental): o jogo foi feito para até 8 jogadores. O motor aceita até 32
  exércitos (os civis do mapa ficam de fora quando não cabem), e a memória limita mais: o SC2 é um
  programa de 32 bits (até 4 GB) e cada exército guarda dados do mapa inteiro. Testado num PC de
  verdade: 32 jogadores em 2048 e 16 em 4096 abrem a partida; 24 e 32 em 4096 fecham o jogo logo
  depois de criar os exércitos, sem relatório de erro. O launcher usa a conta
  jogadores × (lado/1024)² ≤ 256: até 32 jogadores em mapas de até 2560, 28 em 3072, 20 em 3584 e
  16 em 4096 (num mapa com mais bases, ele começa com bases espalhadas e deixa as outras vazias).
  O jogo grava um log em `logs/partida-grande.log` (pasta de dados do launcher); se ele fechar no
  meio, a tela da partida mostra onde parou e o que tentar. Cada IA a mais pesa: com muitas, a IA esperta olha o mapa e decide com
  menos frequência, e o painel dela mostra uma linha por IA. O lobby do jogo desenha só 8 posições e
  **fecha o jogo** com um mapa maior: por isso mapas com mais de 8 bases saem do editor com um tipo
  próprio, que o lobby não lista (mapas feitos na 0.25.0 precisam ser gerados de novo).
- **IA que aprende**: a memória entre partidas passa por um comando no `SimCallbacks.lua`, que o
  menu de trapaças também usa; as duas versões levam os mesmos comandos, mas trapaças montadas
  antes da 0.24.0 não têm todos (memória e "esquecer") — atualize as trapaças depois de instalar.
  A memória só é gravada depois de 5 minutos de partida, para uma partida abandonada no começo não
  apagar o que a IA aprendeu.
- **IA mais esperta** (experimental: confirme no jogo): os ataques "neurais" da IA ficam no executável
  e não dá para editar; o comandante tira as unidades desses ataques e comanda exército, frota e
  aviação ele mesmo. Ele consulta as unidades inimigas pelo motor do jogo, o que pode incluir algumas
  fora da visão da IA.
- **Decorações** são visuais: não bloqueiam a passagem das unidades.
- **Tropas novas, animações criadas e modelos próprios no jogo** são experimentais: veja a tabela
  em [docs/criacao.md](docs/criacao.md#o-que-é-experimental).
- **Misturador de tropas**: as peças são encaixadas pelos ossos (corpo rígido, sem fundir as malhas) e as
  animações da torre/arma são adaptadas pela diferença em relação à pose de repouso. Combinações de
  tamanhos muito diferentes podem precisar de ajuste manual de escala e posição.
- **Texturas procedurais** geram a cor (albedo); os mapas de normal, brilho e a máscara da cor do time
  continuam os do modelo.
- **Verificação de combate**: confere a consistência entre blueprint, modelo e animações (o que a engine
  vai usar); não simula a partida. O comportamento final é sempre o do jogo.
- **Ícones** novos substituem o ícone da unidade base no mesmo tamanho e formato do original.
- **Partidas**: o jogo em si continua nos lobbies da Steam; o launcher organiza as salas, o chat e os
  mods, mas não substitui o netcode do SC2.

## Créditos

Pesquisa e código de outros projetos de Supreme Commander 2 usados aqui: SC2 Map Toolkit
(plutonics72), SupCom2-map-editor (maksing — campos do `info.bdf` da atmosfera), supcom2reversal
(Synraw — lista de funções do motor na Forja) e SC2-Proxima (Rackover — jogar por IP, baixado à
parte). Veja [THIRD_PARTY.md](THIRD_PARTY.md). Supreme Commander 2 é marca registrada de seus respectivos
donos; este projeto não contém nem distribui arquivos do jogo.

Licença: MIT.
