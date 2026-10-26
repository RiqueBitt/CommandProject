# Otimizador (tela Desempenho)

O "mod de melhoria" que vem com o launcher. Ele é **opcional**: nada roda sozinho, e cada ferramenta
pode ser desfeita. Ele não promete ganho de FPS nem de memória: o ganho depende do PC. Por isso a
tela tem um **monitor** para você medir antes e depois de cada mudança, sempre no mesmo mapa.

## O que ele faz

| Ferramenta | O que muda | Como desfazer |
|---|---|---|
| **Monitor do jogo** | nada; mede memória em uso, espaço de endereços (o limite de 2/4 GB de um programa de 32 bits), CPU e tempo aberto, a cada 3 s | — |
| **Memória (2 a 4 GB)** | liga a flag *Large Address Aware* no executável (com cópia do original) e aplica um teto por *Job Object* | escolher 2 GB volta o executável ao original |
| **Prioridade do processo** | `SetPriorityClass` no processo do jogo depois que ele abre (só nessa sessão) | escolher Normal |
| **Opções do jogo** | edita valores do `Game.prefs` que o próprio jogo gravou; antes de cada mudança copia o arquivo para `perf/backups/` | *Backups → Restaurar* (o arquivo atual também vira backup) |
| **Perfis** | fotografia das opções atuais (ex.: “Desempenho” e “Qualidade”), aplicada com um clique; opções que não existem mais são ignoradas | aplicar outro perfil ou restaurar um backup |
| **Travamentos** | nada; lê os `.mdmp` da pasta do jogo: erro, módulo culpado (ex.: `fmod_event.dll`, driver de vídeo) e uma dica | *Apagar* remove só arquivos `.mdmp` |
| **Conflitos entre mods** | nada; mostra arquivos disputados e quem vence | mudar a ordem na biblioteca |
| **Versão do jogo** | nada; lê a versão do executável e compara com a final (1.26) | — |

## Mod de otimização (Biblioteca → Otimização, ou Desempenho → Mod de otimização)

Um mod pequeno, montado com o `uimain.lua` do seu jogo, mais ajustes do Windows só para o
executável do SC2. Não remove nada do jogo (unidades, efeitos e texturas continuam iguais).

| Ajuste | O que muda | Como desfazer |
|---|---|---|
| **Limite de FPS** | no começo de cada partida, `sc_FrameTimeClamp` (tempo mínimo entre quadros, em ms) recebe o limite escolhido. O padrão do jogo é 10 ms = 100 FPS (valor lido do executável); 144 FPS = 7 ms, 60 FPS = 17 ms | escolher "100 FPS (o do jogo)" ou desligar o mod |
| **Limite nas partidas grandes** | com mais de 8 exércitos, troca para um limite menor (padrão 60 FPS): sobra processador para a simulação | escolher "o mesmo das outras partidas" |
| **Placa de vídeo dedicada** | `HKCU\Software\Microsoft\DirectX\UserGpuPreferences`, valor = caminho do `.exe`, `GpuPreference=2;` (o mesmo da tela Gráficos do Windows) | *Desfazer ajustes do Windows* |
| **Sem "otimizações de tela cheia"** | `HKCU\...\AppCompatFlags\Layers`, flag `DISABLEDXMAXIMIZEDWINDOWEDMODE` (outras flags do usuário ficam) | *Desfazer ajustes do Windows* |
| **Sem economia de energia** | `SetProcessInformation(ProcessPowerThrottling)` no processo do jogo depois que ele abre | *Desfazer ajustes do Windows* |
| **Prioridade e modo 4 GB** | as mesmas ferramentas da tabela acima, ligadas pelo mod | escolher Normal / 2 GB |

## O que ele **não** faz, de propósito

- Não aplica parâmetros de inicialização inventados.
- Não modifica o executável além da flag de 4 GB (documentada, com backup e reaplicação se a Steam
  restaurar o arquivo).
- Não altera arquivos originais do jogo sem cópia de segurança.
- Não inventa opções no `Game.prefs`: só altera as que o jogo já gravou.

## Onde ficam os arquivos

- Opções do jogo: `%LOCALAPPDATA%\Gas Powered Games\Supreme Commander 2\Game.prefs`
  (a variável `CP_GAME_PREFS` troca o caminho).
- Backups e perfis: `%APPDATA%\io.github.riquebitt.commandproject\perf\`.
- Relatórios de travamento: pasta `bin` do jogo (`*.mdmp`).
