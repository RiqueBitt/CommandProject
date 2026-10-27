# Créditos e licenças de terceiros

| Componente | Uso | Licença |
|---|---|---|
| [SC2 Map Toolkit](https://github.com/plutonics72/supcom2-map-toolkit) — plutonics72 (commit `2e17371`) | Estúdio de Mapas (`resources/maptk/sc2maps.py`, `make_map.py`, `FORMATS.md`) — incluído sem alterações | MIT — `resources/maptk/LICENSE` |
| [SupCom2-map-editor](https://github.com/maksing/SupCom2-map-editor) — maksing (commit de 17/10/2026) | deslocamentos e limites dos campos do `info.bdf` (sol, sombras, água, neblina, bloom, vento) usados na **Atmosfera** do editor de mapas (`resources/maptk/cp_world.py`); nenhum arquivo copiado | MIT |
| [supcom2reversal](https://github.com/Synraw/supcom2reversal) — Synraw | lista das funções e tabelas globais da simulação (`notes/dump_simglobals.txt`) no autocompletar da Forja (`src/lib/sc2Globals.ts`) | Domínio público (The Unlicense) |
| [SC2-Proxima](https://github.com/Rackover/sc2-proxima) — Rackover | **não vem junto e não é modificado**: o launcher baixa o lançamento oficial do GitHub quando o usuário pede e o coloca no jogo só durante as partidas por IP abertas pelo launcher (programa separado, agregação) | GPL-3.0 |
| Tauri 2 | app desktop | MIT / Apache-2.0 |
| React, Zustand, dnd-kit | interface | MIT |
| CodeMirror 6 | editor de Lua | MIT |
| three.js | visualizador 3D | MIT |
| Material Icons (via Fontsource) | ícones | Apache-2.0 |
| Roboto (via Fontsource) | tipografia | OFL-1.1 |
| Rajdhani (via Fontsource, Indian Type Foundry) | títulos do visual Comando | OFL-1.1 |
| texpresso | compressão DXT/BC | MIT |
| zip, image, reqwest, sha2, sysinfo e demais crates | núcleo em Rust | MIT / Apache-2.0 |
| axum, tokio, tower-http | servidor da comunidade | MIT |
| [ReShade](https://reshade.me) — crosire | não vem junto: o launcher baixa o instalador oficial quando você pede; o compilador de efeitos (`tools/fxc.cpp`, commit `7bf9de8`) é usado só nos testes do CI | BSD-3-Clause |
| Python embutido (python.org, só no instalador do Windows) | executar o toolkit de mapas | PSF License |

Ideias de recursos (sem código copiado): [Definitive Supreme Commander Launcher](https://github.com/ageekhere/Definitive-Supreme-Commander-Launcher)
(o repositório não declara licença, por isso nada dele foi reutilizado; o "prender o mouse na
janela" foi escrito do zero com a API do Windows).

Analisados e não usados: [supcom-map-editor](https://github.com/matthieucarme/supcom-map-editor)
(MIT, mas é do Supreme Commander 1 — outro formato de mapa), [SC2-CloneWars](https://github.com/PolwieV3/SC2-CloneWars)
e [sc2-unit-cap-patch](https://github.com/rowanmorse-demo/sc2-unit-cap-patch) (sem licença declarada;
a Partida grande do launcher já chega a 5000 unidades).

Supreme Commander 2 é marca registrada de seus respectivos donos. O CommandProject não
contém nem distribui arquivos do jogo: tudo é lido da instalação do próprio usuário.

## FFmpeg (baixado só quando você pede)

A "Tela inicial nova" converte o vídeo de fundo que você escolher com o **FFmpeg**
(https://ffmpeg.org, LGPL/GPL). O launcher não traz o FFmpeg: o botão "Baixar o ffmpeg" baixa a
compilação para Windows de BtbN/FFmpeg-Builds (GitHub) para a pasta de dados do launcher, ou usa
um `ffmpeg` que já esteja no seu computador.
