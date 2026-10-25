# Criação: mapas, tropas e modelos 3D

O botão **Criar** (barra superior, trilho lateral ou `+` nas abas) abre a tela de projetos. Cada
projeto abre numa **aba própria**, como um editor de jogo: dá para manter vários abertos e trocar
entre eles sem perder nada (as abas ficam montadas em segundo plano).

## Projetos

- Ficam em `%APPDATA%\io.github.riquebitt.commandproject\creations\<id>\`:
  `meta.json`, `doc.json` (o projeto), `autosave.json`, `versions/`, `assets/` (imagens, OBJ/GLB,
  animações), `export/` (modelo preparado para o jogo) e `thumb.png`.
- **Salvamento automático** a cada 15 s enquanto houver mudanças. Se o launcher fechar sem salvar,
  a aba mostra uma faixa de **recuperação** na próxima abertura.
- **Versões**: cada salvamento manual guarda uma versão (as 40 mais novas), e o salvamento
  automático guarda uma a cada 5 min no máximo. *Versões* na barra do projeto restaura qualquer uma
  (a atual também vira versão antes).
- **Desfazer/refazer** (`Ctrl+Z` / `Ctrl+Y`) em todos os editores.
- Menu de contexto do projeto: abrir, favoritar, renomear, duplicar, **exportar `.cpproj`**
  (zip com tudo, para compartilhar) e apagar (vai para `creations-trash/`). *Importar* aceita `.cpproj`.

## Editor de mapas

Layout: caixa de recursos à esquerda, vista 3D no centro, explorador e propriedades à direita.

### Começar em branco

Um mapa novo já abre pronto para editar, sem escolher terreno: um **chão liso de grama** do tamanho
escolhido (**512 × 512** ou **1024 × 1024**). Dá para esculpir, gerar um mundo por cima, decorar e
trocar a textura do chão à vontade. Por baixo vai um terreno do jogo só como suporte (sem água e com
a malha do chão acompanhando o relevo: `SC2_MP_004` no 512, `SC2_MP_007` no 1024) — nada dele
aparece. Em **Propriedades → Começar de** dá para trocar para um mapa do jogo (ou voltar ao branco);
mapas de 2048 só a partir de um mapa do jogo.

### Visual limpo (nada do mapa original por cima)

Num mapa feito a partir de um mapa do jogo, o chão do jogo tem o "desenho" do mapa original: as
camadas de areia, rocha e cidade e as sombras pré-calculadas de morros e prédios ficam nos lugares de
antes. Com um relevo novo por cima, isso aparecia como manchas e sombras fora do lugar. O **visual
limpo** (ligado no mapa em branco e ao gerar um mundo; em Propriedades → Chão e visual) resolve:

- a **malha do chão é refeita** para o relevo novo (no jogo e na colisão: a câmera e os tiros
  acompanham o chão novo);
- o chão ganha as **texturas do bioma** (abaixo), com mistura entre elas;
- a **luz do chão é refeita** (sombras do relevo novo, com a cor do céu do mapa);
- **todas** as decorações do terreno original saem (as suas e as do gerador ficam).

### Chão por biomas e pincel de textura

Com o visual limpo, cada ponto do chão recebe uma de cinco texturas do bioma, numa cadeia:
**praia** (junto da água), **chão** (grama, areia, neve…), **terra** (manchas e encostas leves),
**rocha** (encostas íngremes) e **topo** (neve ou o equivalente do bioma nos pontos mais altos). O
jogo mistura vizinhas da cadeia, então as passagens ficam suaves.

- **Pincel de textura** (Início → Pintar chão, ou a aba **Chão** da caixa de recursos): escolha a
  textura (praia, chão, terra, rocha, topo) e pinte partes do mapa — estradas, clareiras, neve num
  pico. **Automático** é a borracha. Tamanho e força ajustáveis; a simetria ao colocar vale também.
- **Bioma**: grama, areia, neve ou terra escura. Cada papel pode trocar de textura (qualquer uma do
  jogo, ou uma sua — abaixo).
- **Paisagem em volta do mapa**: fora da área jogável o relevo continua a borda e sobe em montanhas,
  com as mesmas texturas (nada de chão liso infinito).
- Mapas em branco de 1024 já vêm com água (nível 40): lagos e rios gerados aparecem de verdade.

### Céu

Em **Propriedades → Chão e visual → Céu** (ou no gerador de mundo, em Acabamento) escolha o céu de
qualquer mapa do jogo: a caixa do céu, o reflexo do ambiente e a correção de cor dele vão para o seu
mapa (a prévia do editor ganha a cor do céu). "O do terreno base" mantém o original. Em mapas de
plataformas, desligue **Neve no alto** (o gerador já faz isso) para o topo das plataformas não virar
neve.

### Texturas próprias (.png / .jpg)

No **Trocar textura** de qualquer papel do bioma, **Importar imagem como textura** (ou arraste a
imagem para a janela): .png, .jpg, .webp ou .bmp. A imagem vira um quadrado de até 1024 px (recorte
no centro) e, com **Deixar contínua**, as bordas são misturadas para não aparecer emenda quando ela
se repete no chão. O PNG fica nos arquivos do projeto; ao gerar o mapa, o app cria as três texturas
do jogo (cor, relevo tirado do brilho da imagem e brilho) em `/textures/terrain/cp/` dentro do
pacote do mapa. As importadas aparecem em **Minhas texturas** (o × tira da lista do mapa).

### Gerar mundo (por semente)

**Gerar mundo** (tecla `G`, faixa Início ou Terreno) abre o gerador:

- **Estilos prontos**: vales verdes, montanhas, terra dos lagos, arquipélago, deserto, terra
  arrasada, gelo e campo aberto. Cada estilo só preenche os controles; tudo pode ser ajustado.
- **Semente**: o mesmo número gera sempre o mesmo mundo (o dado sorteia outra).
- **Jogadores e simetria**: 2 a 8 bases. As simetrias são espelho (esquerda/direita, cima/baixo,
  diagonal), giro de 180° ou giro de 90°. Relevo, formas e decorações saem iguais para todos os lados.
- **Relevo**: quanto do terreno base é substituído, altura da terra, ondulação e largura das ondas.
- **Montanhas** (com picos irregulares), cordilheiras, colinas e planaltos.
- **Água**: lagos, rios com curvas e ilhas.
- **Cavidades**: crateras, cânions e campos de dunas.
- **Vida e estruturas**: florestas em manchas naturais (bosques de uma espécie, árvores menores na
  borda, chão de terra e folhas embaixo), árvores na beira de rios e lagos e soltas nos campos,
  pedras (mais nas encostas e no pé dos paredões, grandes no meio e pequenas em volta), ruínas e
  postos em áreas planas, destroços espalhados.
- **Vida humana**: **vilas** com rua principal (e às vezes rua cruzada), casas alinhadas dos dois
  lados, praça, postes, armazéns com caixas e árvores em volta; **estradas de terra** que seguem o
  caminho mais fácil (desviam de subidas e da água) ligando cada vila à base mais perto e à vila
  vizinha, com árvores, pedras e postes na beira; e **plantações** em faixas em volta das vilas (no
  bioma temperado). O chão de ruas, estradas, praça e plantações vem pintado pelo gerador numa camada
  própria, por baixo da sua pintura. No bioma vulcânico as vilas viram ruínas.
- **Caminhos**: trilhas de terra das bases até o centro e as expansões (e as estradas das vilas)
  que seguem o terreno; viram formas **Caminho** editáveis (o chão é aplainado de leve e pintado de
  terra; dá para desenhar caminhos novos em Formas).
- **Suavidade**: montanhas e morros sem pontas e margens de rios e lagos limpas (somem as poças e
  ilhotas de poucos metros e a linha d'água fica suave).
- **Detalhe fino do chão**: ondulações pequenas, sulcos e lombadas em todo o terreno. O relevo do
  editor e do mapa usa um ponto a cada 2 unidades num mapa 1024 (quatro vezes mais pontos que antes).
- **Estratégia**: expansões de massa por jogador (a primeira **segura**, bem mais perto da própria
  base; a última **disputada**, no meio do caminho), **centro disputado** (área plana com 4 pontos de
  massa) e **paredões** que criam gargalos. A massa gerada é simétrica, fica em chão plano, seco e
  alcançável, aparece no explorador e pode ser movida. Em "Massa: automática do toolkit" o toolkit
  sorteia as expansões na hora de gerar.
- **Estilo do terreno: plataformas sobre um abismo** (estilos prontos "Plataformas no abismo" e
  "Fortalezas suspensas", no jeito de Shiva Prime, Geothermal Borehole e Sinorok Rift Armory): as
  bases, o centro e as expansões ficam em plataformas altas de borda a pique, ligadas por **pontes**;
  o resto do mapa é um abismo (fundo de rocha ou mar). Os paredões descem em degraus de rocha, com
  contrafortes e cascalho no pé; beirais mais baixos encostados nas plataformas e torres de pedra
  soltas dão a noção de altura. As pontes ganham textura própria de metal/piso (escolha em **Chão →
  Pontes**), portal nas cabeceiras e postes dos dois lados; a beira das plataformas tem pedras e
  entulho, e a paisagem em volta continua o abismo. Controles: altura da queda (até 260), número
  de plataformas de expansão, torres e fundo do abismo. A massa só vai para o que é alcançável a pé,
  e se alguma base ficar isolada o gerador põe mais uma ponte.
- **Acabamento**: bordas (montanhas, borda rochosa ou mar), economia, **céu** e cores do minimapa.
- **Ver 6 variações**: a mesma configuração com sementes vizinhas, lado a lado; clique para escolher.

A prévia ao vivo mostra o mapa de cima, as bases, as linhas de rios e cordilheiras, o total de
formas e decorações e a % caminhável. O gerador:

- deixa a área de cada base plana;
- confere se todas as bases se alcançam a pé e, se alguma ficar isolada, abre passagens;
- não coloca decorações em cima da massa nem uma em cima da outra;
- deixa um chão plano embaixo de cada ponto de massa (também na massa colocada à mão), para o
  extrator não ficar torto nem meio enterrado.

Ao gerar o mapa, decorações que ficaram debaixo d'água (o relevo mudou depois de colocá-las) ficam
de fora e o aviso diz quantas. A margem da água no jogo segue o relevo ponto a ponto (antes
aparecia em degraus quadrados).

**Validar** (faixa Jogo) confere o mapa inteiro e roda também antes de gerar (erros graves pedem
confirmação):

- bases fora do mapa, na água, em declive, coladas na borda, muito perto ou sem caminho;
- distâncias até o inimigo e massa desiguais entre os times;
- massa fora do mapa, na água, em declive, sobreposta, no centro de uma base ou inacessível;
- decorações sobrepostas, dentro das bases, em cima da massa, fora do mapa ou debaixo d'água.

**Corrigir automaticamente** move a massa para o chão válido mais perto e tira as decorações com
problema (bases e relevo não mudam; Ctrl+Z desfaz).

**Depois de gerar, tudo é editável**:

- montanhas, lagos, rios etc. ficam em **Formas do terreno** no explorador: arraste para mover,
  mude raio, altura, irregularidade, ou **Variar** a forma;
- apague ou duplique;
- decorações geradas ficam marcadas como "gerada";
- gerar de novo troca só o que o gerador fez: o que você criou ou mexeu fica.

### Esculpir

- **Pincel** (faixa Terreno): subir (`R`), descer (`F`), suavizar (`S`), nivelar e irregular, com
  raio e força. O que foi pintado fica numa camada própria ("Pincel de escultura" no explorador),
  que dá para esconder para comparar ou apagar.
- **Formas** (faixa Formas): montanha, colina, cordilheira (arrastar), planalto, dunas, ilha, lago,
  rio (arrastar), cânion (arrastar), cratera e passagem. Cada uma vira um objeto editável.
- **Plataformas e abismo** (faixa Formas): **plataforma** (topo plano, borda a pique, medida a
  partir do chão mais baixo em volta), **ponte** (arrastar de uma plataforma a outra: tabuleiro
  plano), **abismo** (buraco fundo de paredes retas) e **fenda** (arrastar). Dá para montar um mapa
  de plataformas à mão ou mexer no que o gerador fez.
- **Relevo simples**: morro, vale, platô, área plana, rampa e vau sobre a água.
- **Simetria ao colocar**: com uma simetria ligada, bases, massa, decorações, formas, relevo e
  pinceladas são repetidos nos outros lados do mapa.

### Selecionar, mover, girar e mudar o tamanho

- **Clique** seleciona (bases, massa, decorações, formas, cortes); **Shift** soma à seleção;
  **arrastar no vazio** seleciona por caixa; **Ctrl+A** seleciona tudo.
- **Transformar** (faixa Início): **Mover** (W), **Girar** (Q) e **Escala** (T). Arraste a seleção:
  girar gira em volta do centro (Shift: de 15 em 15°); escala aumenta/diminui (decorações mudam de
  tamanho, formas mudam de raio, grupos se espalham ou juntam).
- Teclado: setas movem 2 unidades (Shift: 10), **,** e **.** giram 15°, **-** e **+** mudam 10%.
- **Decorações do mapa original** (mapas feitos sobre um mapa do jogo, sem o visual limpo): um clique
  numa delas a transforma numa decoração editável (a original sai e entra a cópia no mesmo lugar).
- No jogo, cada decoração fica na altura exata do chão que aparece (malha do chão), sem flutuar nem
  afundar em encostas e bordas.

### Passagem das tropas

Faixa **Terreno → Passagem das tropas**: **Bloquear** pinta onde as tropas por terra não passam
(vermelho), **Liberar** onde passam mesmo sendo íngreme (verde) e **Automático** volta à regra do
jogo (inclinação e água). **Mostrar** colore o mapa: vermelho claro é o que já é intransponível pela
inclinação ou pela água. O gerador de mundo já fecha as encostas íngremes das montanhas (opção
"Montanhas íngremes bloqueiam as tropas"), sem nunca separar as bases; a validação e a análise usam o
mesmo mapa de passagem. No jogo, isso entra na navegação do mapa (unidades aéreas e navais não mudam).

### Organizar, analisar e exportar

- **Esconder e travar** no explorador (olho e cadeado), por grupo ou por objeto. Uma forma
  escondida fica desligada, para comparar o mapa com e sem ela. Objetos travados não são
  selecionados nem movidos.
- **Exibir → Análise**: território de cada base pelo caminho a pé, fronteira entre os times,
  caminhos mais curtos, gargalos e distância até o inimigo. Mostra se o mapa está equilibrado.
- **Exibir → Chão do jogo** (visual limpo): a textura escolhida com a luz e as sombras do relevo,
  como fica no jogo. Sem o visual limpo, **Cores do relevo** usa as texturas do terreno base.
- **Prévia do lobby**: como o mapa aparece na lista do jogo. O minimapa "cores do relevo" é gerado
  a partir do relevo novo.
- **Jogo → Exportar .scd**: depois de **Gerar mapa**, salva o `.scd` numa pasta (para compartilhar
  ou instalar à mão).

### Mais ferramentas

- **Começar de**: mapa em branco (512 ou 1024) ou um dos terrenos do jogo (relevo, água e texturas vêm dele).
- **Inserir**: bases (2 a 8), massa extra, relevo (morro, vale, planalto), cortes, passagens.
- **Objetos**: decorações do jogo com o **modelo e a textura reais** (lidos da sua instalação),
  modelos próprios feitos no editor 3D (experimental), retirada de decorações do terreno.
- **Chão**: com o visual limpo, o pincel de textura, o bioma, as texturas de cada papel (do jogo ou
  importadas) e a paisagem em volta; sem ele, troca de camadas uma a uma por camadas de qualquer
  mapa do jogo.
- Selecionar e arrastar, seleção múltipla (`Shift`), duplicar (`Ctrl+D`), excluir (`Del`),
  visão 2D, grade.
- **Gerar mapa** / **Gerar e jogar**: monta o mapa com o SC2 Map Toolkit, confere se todas as bases
  se alcançam e instala como mod.

## Editor de modelos 3D

- **Formas**: bloco, cilindro, esfera, cone, anel, rampa, placa, cápsula; **importar OBJ/GLB**.
- Mover/girar/escalar com gizmo, encaixe na grade, espaço local/mundo, **edição de vértices**.
- **Grupos** viram **ossos** no jogo (com pivô próprio). Para uma tropa, use os nomes dos ossos do
  modelo original (ex.: `Turret`, `Turret_Barrel`, `Turret_Muzzle`).
- **Material**: cor, imagem (com repetição), texturas do jogo, rugosidade, metal, brilho
  (glow) e **cor do time**.
- **Exportar**:
  - *Preparar para o jogo*: gera `.scm` (versão 7) + texturas `.dds` (albedo, specteam, normal)
    e guarda no projeto; é o que mapas e tropas usam.
  - *Validar*: triângulos, ossos, UVs e tamanho.
  - `.scm/.dds` para uma pasta, ou **OBJ/GLB** para outros programas.
- Modelos prontos: vazio, torre, caixas, tanque.

## Criador de tropas

Uma tropa nova sempre parte de uma **unidade base** do jogo. A base não é alterada: o launcher gera
uma unidade nova (`units/<novo id>/`) num mod próprio (`tropa-<id>`), que aparece na biblioteca e
pode ser ligada, desligada ou apagada como qualquer mod.

- **Geral**: nome, descrição, id (4 a 16 letras minúsculas/números, único).
- **Aparência** (separada do comportamento): modelo da base ou **modelo próprio** do editor 3D,
  escala, matiz/saturação/brilho da textura, ou uma **imagem PNG** própria (precisa seguir o mapa
  UV do modelo). Para modelos próprios a tela mostra quais ossos da base existem no seu modelo.
- **Atributos**: defesa (vida, regeneração, escudo), custo e construção, movimento (terrestre,
  aérea, naval, anfíbia, hover), visão e radar, tamanho/colisão.
- **Armas**: dano, raio, alcance, cadência, projétil, velocidade, imprecisão, torre e qualquer
  outro campo da arma.
- **Animações**: ver em 3D, **trocar** por qualquer animação do jogo (com velocidade) ou **criar
  uma nova** por quadros-chave (osso, tempo, rotação e deslocamento).
- **Comportamento**: categorias (quem constrói, alvos, IA).
- **Todos os campos**: qualquer valor numérico do blueprint.
- **Blueprint (texto)**: o arquivo final; só os valores alterados mudam, comentários e ordem ficam.
- **Equilíbrio**: compara vida, dano por segundo, alcance, velocidade e custo com a base (ou outra
  unidade). Mostra a força pelo custo e avisa se a tropa pode desequilibrar as partidas.
- **Modelos de função**: tanque pesado, artilharia, batedor, barata em massa, atirador de longe,
  aérea rápida e elite. Ajustam vários atributos de uma vez, sempre a partir da base.
- **Copiar arma de outra unidade**: galeria com dano, cadência, alcance e projétil de cada arma do
  jogo. Troca uma arma ou adiciona uma nova, levando projétil, efeitos e sons originais.
- **Pintar no modelo**: pincel direto na vista 3D (cor, tamanho, força). Cada pincelada vira a
  textura da tropa.
- **Ícone**: gerado da vista 3D (fundo transparente) ou PNG próprio. Substitui o ícone da base no
  mesmo tamanho e formato.
- **Assistente de ossos**: com um modelo próprio, liga cada osso que as armas usam a um grupo do
  seu modelo.
- **Linha do tempo de animação**:
  - ossos à esquerda e quadros-chave (losangos) arrastáveis no tempo;
  - giro e deslocamento do quadro escolhido;
  - modelos prontos: torre vigiando, recuo do tiro, balanço ao andar, abrir, tombar, construir;
  - prévia ao vivo na vista 3D, igual ao arquivo gerado.

  As animações feitas aqui podem ser reabertas e editadas.
- **Quem constrói**: fábricas (categorias BUILTBY…) com a lista de todas as categorias do jogo.
- **Pacotes**: várias tropas num mod só (`pacote-<nome>`).
- **Misturar 3 tropas**: o chassi é a unidade base; escolha a **torre** de uma segunda tropa e a
  **arma** (cano + arma do blueprint, com projétil, efeitos e sons) de uma terceira.
  - As peças são transplantadas pelos ossos da torre/cano, com escala automática pela largura do
    chassi (ou manual), giro e deslocamento.
  - Os ossos que as armas usam ficam com os nomes do chassi; os demais ganham prefixo (T_/W_).
  - As texturas (cor, specteam e normal) viram um atlas com os pedaços usados de cada tropa.
  - As animações da base são adaptadas ao esqueleto novo; o blueprint é conferido e os ossos que
    sumiram são reparados.
  - Verificações: peça solta ou enterrada, torre larga demais, UVs, limites do formato.
- **Gerador de texturas**: trabalha no espaço UV do modelo (base, misturado ou próprio). Cada texel
  sabe a posição 3D, a normal e a distância às quinas, então a camuflagem não quebra nas emendas e o
  desgaste aparece onde a tinta realmente gasta.
  - Estilos prontos: original com desgaste, floresta, deserto, urbana, inverno digital, naval,
    listras de tigre, veterano enferrujado e parada.
  - Camadas com semente própria (o dado de cada uma regenera **só aquela camada**): pintura e
    camuflagem, painéis (frestas, grades, escotilhas, rebites, tom de cada placa), marcações (faixa,
    placas zebradas), desgaste (lascas nas quinas, arranhões, metal exposto) e sujeira (lama embaixo,
    frestas, escorridos e poeira em cima).
  - "Detalhes" e "sombras do original" preservam o trabalho do artista da textura do jogo.
  - Prévia ao vivo no modelo, **segure para ver o original**, **lado a lado** com divisória e zoom,
    versões guardadas no projeto (aplicar, comparar com a anterior, exportar PNG).
  - Se a mistura ou o modelo mudar depois, a validação avisa que a textura precisa ser gerada de novo.
- **Gerador de ícones**: câmera (giro, altura, perspectiva, preenchimento), luz principal, ambiente e
  de contorno, fundo (painel tático, degradê, cor lisa, transparente) com moldura, contorno da
  silhueta, símbolo da função (terrestre, aérea, naval, artilharia, antiaérea, engenheiro,
  experimental, estrutura, escudo) e nitidez para tamanhos pequenos. Mostra 24, 32, 48 e 64 px em
  fundo claro e escuro e confere preenchimento e contraste. O estilo é salvo e vale para todas as
  tropas. Também na área **Ícones**, para tropas do jogo e exportação em lote.
- **Validação**, inclusive de arquivos citados que não existem no jogo (projéteis, animações…).
- **Combate, movimento e animações** (roda sozinho na Validação e sempre antes de gerar; erros
  impedem gerar):
  - movimento: tipo de movimento × categorias (AIR, NAVAL, LAND), velocidade, aceleração, frenagem,
    giro, altura do hover;
  - colisão e seleção: SizeX/Y/Z × tamanho real do modelo × escala;
  - armas e mira: ossos de giro, elevação, boca e rack existem; a elevação está presa ao giro e a boca
    à torre (senão o cano não acompanha a torre); boca abaixo do chão; alcance mínimo × máximo,
    cadência, alcance × visão; categorias de ataque sem arma;
  - ossos: pais válidos, rotações normalizadas, nomes repetidos, peças soltas do resto do corpo;
  - animações: ossos que não existem no modelo, valores inválidos, quadros fora de ordem, peças que
    esticam ou se soltam, rotações bruscas entre quadros, andar/parado que não volta à pose inicial.
- **Gerar tropa** ou **Gerar e jogar**.

## O que é experimental

O launcher nunca supõe que o jogo aceita um formato não testado. Hoje:

| Recurso | Situação |
|---|---|
| Mapas gerados pelo toolkit | testado no jogo |
| Decorações do jogo em mapas | testado no jogo |
| Troca de textura do chão | testado no jogo (o nome novo precisa caber no original) |
| **Modelos próprios como decoração** | experimental: `.scm` v7 escrito pelo launcher, ainda sem confirmação no jogo |
| **Tropas novas** | experimental: blueprint em texto em `/units/<id>/`, script herdado da base. Confirme se a unidade aparece na fábrica da facção da base |
| **Animações criadas por quadros-chave** | experimental: `.sca` gerado a partir dos ossos da base/modelo |
| Modelo próprio numa tropa | experimental: armas e efeitos dependem dos nomes dos ossos |
| **Lagos e rios novos em terrenos com água** | experimental: a máscara de água é refeita e o id do mapa fica com o tamanho do id do terreno (exigência do formato) |
| Lagos e rios em terrenos sem água | viram vales e leitos secos (o jogo não desenha água num terreno feito sem ela) |
| Relevo gerado (montanhas, formas, pincel) | mesma técnica do relevo esculpido, que já funciona no jogo |
| **Visual limpo / mapa em branco** | malha nova do chão e colisão: testadas no jogo (carrega, câmera acima do chão); **biomas, pincel e luz refeita**: experimental (máscaras novas no formato das originais) |
| **Céu de outro mapa** | experimental: troca os caminhos do céu, do reflexo e da correção de cor no `info.win.bdf` |
| **Plataformas sobre abismo** | relevo e pontes: mesma técnica do relevo gerado; paredões altos ainda precisam de confirmação no jogo (câmera e navegação) |
| **Texturas importadas** | experimental: DDS gerados pelo launcher no formato das texturas de chão do jogo |
| **Paisagem em volta e água no mapa em branco** | experimental |
| Armas copiadas e ícone gerado | experimental: confira os pontos de disparo e o ícone no jogo |
| Pacotes de tropas | experimental (mesmo caminho das tropas sozinhas) |

Se algo experimental não funcionar, desligue o mod na biblioteca e abra uma issue com o que
aconteceu (e o relatório de travamento da tela Desempenho, se houver).

## Formatos

- **SCM** (malha): leitura v5–v7, escrita v7. Vértice de 68 bytes; ossos com posição/rotação
  relativas ao pai e a inversa da pose de descanso.
- **SCA** (animação): cabeçalho `ANIM`, nomes e pais dos ossos, quadros com posição + quatérnio
  (w, x, y, z).
- **Blueprints**: tabelas Lua em texto (`UnitBlueprint { ... }`). O editor troca só o trecho do valor.
- **DDS**: DXT1/DXT5 com mipmaps.

## Desenvolvimento

Código:

- Rust (`crates/cp-core/src/`):
  - `creator.rs`: projetos, versões, recuperação, assets, `.cpproj`;
  - `resources/maptk/maptk_bridge.py`: camada de relevo (`height_delta`), máscara de água e
    minimapa natural;
  - `blueprint.rs`: leitor/editor de blueprints;
  - `anim.rs`: SCA;
  - `modelgen.rs`: modelo do editor para SCM e DDS;
  - `units.rs`: catálogo, detalhes e geração de tropas;
  - `perf.rs`: Otimizador.
- Tauri: `src-tauri/src/creator_cmds.rs`, `src-tauri/src/perf_cmds.rs`.
- Interface:
  - `src/pages/create/` (Create, MapStudio, ModelStudio, UnitStudio e as vistas 3D);
  - `src/pages/create/worldgen.ts` (gerador: ruído, simetria, formas, decorações, pincel) e
    `mapAnalysis.ts` (equilíbrio do mapa); `animKeys.ts` (animação por quadros-chave);
  - `src/components/studio/kit.tsx` (faixa de ferramentas, painéis, árvore, propriedades);
  - `src/lib/useProject.ts`, `src/lib/tabs.ts`.

Testes (`npm run test:core`) cobrem:

- projetos: salvar, recuperar, versões, exportar/importar;
- blueprints: ler, alterar e criar campos;
- SCA e SCM: ida e volta;
- geração de modelos e de tropas;
- o Otimizador: opções com backup, perfis, minidumps e versão do executável;
- implantação e TOC: instalar mods e voltar ao original.
- gerador de mundos (`npm run test:worldgen`): mesma semente gera o mesmo mapa, a simetria é exata
  e todas as bases se alcançam;
- ponte do toolkit (`npm run test:maps`): camada de relevo, máscara de água, minimapa natural, base lisa,
  decorações originais retiradas e luz refeita numa malha de teste (`cp_lighting.py`).

Alguns testes também rodam com arquivos reais do jogo quando as variáveis `CP_REAL_BP` e
`CP_REAL_SCA` apontam para eles.
