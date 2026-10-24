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
- **Vida e estruturas**: florestas em manchas naturais, pedras (mais nas encostas), ruínas e postos
  em áreas planas, destroços espalhados.
- **Acabamento**: bordas (montanhas, borda rochosa ou mar), economia e cores do minimapa.

A prévia ao vivo mostra o mapa de cima, as bases, as linhas de rios e cordilheiras, o total de
formas e decorações e a % caminhável. O gerador:

- deixa a área de cada base plana;
- confere se todas as bases se alcançam a pé e, se alguma ficar isolada, abre passagens.

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
- **Relevo simples**: morro, vale, platô, área plana, rampa e vau sobre a água.
- **Simetria ao colocar**: com uma simetria ligada, bases, massa, decorações, formas, relevo e
  pinceladas são repetidos nos outros lados do mapa.

### Organizar, analisar e exportar

- **Esconder e travar** no explorador (olho e cadeado), por grupo ou por objeto. Uma forma
  escondida fica desligada, para comparar o mapa com e sem ela. Objetos travados não são
  selecionados nem movidos.
- **Exibir → Análise**: território de cada base pelo caminho a pé, fronteira entre os times,
  caminhos mais curtos, gargalos e distância até o inimigo. Mostra se o mapa está equilibrado.
- **Exibir → Cores do relevo**: água, areia, grama, rocha e neve pela altura e inclinação.
  É só a prévia: no jogo o chão usa as texturas do terreno base (troque em **Chão**).
- **Prévia do lobby**: como o mapa aparece na lista do jogo. O minimapa "cores do relevo" é gerado
  a partir do relevo novo.
- **Jogo → Exportar .scd**: depois de **Gerar mapa**, salva o `.scd` numa pasta (para compartilhar
  ou instalar à mão).

### Mais ferramentas

- **Terreno base**: um dos terrenos do jogo (relevo, água e texturas vêm dele).
- **Inserir**: bases (2 a 8), massa extra, relevo (morro, vale, planalto), cortes, passagens.
- **Objetos**: decorações do jogo com o **modelo e a textura reais** (lidos da sua instalação),
  modelos próprios feitos no editor 3D (experimental), retirada de decorações do terreno.
- **Chão**: troca de camadas de textura por camadas de qualquer mapa do jogo.
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
- **Validação**, inclusive de arquivos citados que não existem no jogo (projéteis, animações…).
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
| Relevo gerado (montanhas, formas, pincel) | mesma técnica do relevo esculpido, que já funciona no jogo; as texturas do chão continuam as do terreno base |
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
- ponte do toolkit (`npm run test:maps`): camada de relevo, máscara de água e minimapa natural.

Alguns testes também rodam com arquivos reais do jogo quando as variáveis `CP_REAL_BP` e
`CP_REAL_SCA` apontam para eles.
