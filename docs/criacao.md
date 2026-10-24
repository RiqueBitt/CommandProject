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
- **Validação** antes de gerar; **Gerar tropa** ou **Gerar e jogar**.

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
  - `blueprint.rs`: leitor/editor de blueprints;
  - `anim.rs`: SCA;
  - `modelgen.rs`: modelo do editor para SCM e DDS;
  - `units.rs`: catálogo, detalhes e geração de tropas;
  - `perf.rs`: Otimizador.
- Tauri: `src-tauri/src/creator_cmds.rs`, `src-tauri/src/perf_cmds.rs`.
- Interface:
  - `src/pages/create/` (Create, MapStudio, ModelStudio, UnitStudio e as vistas 3D);
  - `src/components/studio/kit.tsx` (faixa de ferramentas, painéis, árvore, propriedades);
  - `src/lib/useProject.ts`, `src/lib/tabs.ts`.

Testes (`npm run test:core`) cobrem:

- projetos: salvar, recuperar, versões, exportar/importar;
- blueprints: ler, alterar e criar campos;
- SCA e SCM: ida e volta;
- geração de modelos e de tropas;
- o Otimizador: opções com backup, perfis, minidumps e versão do executável;
- implantação e TOC: instalar mods e voltar ao original.

Alguns testes também rodam com arquivos reais do jogo quando as variáveis `CP_REAL_BP` e
`CP_REAL_SCA` apontam para eles.
