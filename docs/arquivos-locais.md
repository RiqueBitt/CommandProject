# Arquivos locais

O CommandProject funciona inteiro no seu computador. Não há banco de dados, conta, telemetria nem
sincronização em nuvem. Tudo fica na **pasta de dados** do launcher (no Windows,
`%APPDATA%\CommandProject`), em formatos comuns:

| O quê | Onde | Formato |
|---|---|---|
| Configurações | `settings.json` | JSON |
| Perfis de mods | `profiles.json` | JSON |
| Projetos (mapas, tropas, modelos) | `creations/<id>/` | `meta.json`, `doc.json`, `autosave.json`, `versions/*.json` |
| Texturas, ícones, animações e modelos dos projetos | `creations/<id>/assets/` | PNG, SCA, OBJ/GLB |
| Lixeira de projetos | `creations-trash/` | pastas dos projetos apagados |
| Cópias de segurança | `project-backups/` | `.zip` |
| Biblioteca de mods | `library/` | `.scd` + `mod.json` |
| Arquivos originais do jogo (para restaurar) | `backups/` | cópias dos originais |

## Salvamento e recuperação

- Cada projeto tem **salvamento automático** (`autosave.json`) enquanto você edita. Se o launcher ou
  o PC cair, ao abrir de novo o editor oferece recuperar.
- **Versões**: cada salvamento guarda o documento anterior (as 40 mais recentes) e dá para voltar.
- Se o `doc.json` estiver danificado, o projeto é recuperado do salvamento automático ou da versão mais
  nova, e o arquivo danificado fica guardado como `doc.corrompido-<data>.json`.
- Apagar um projeto manda para a **lixeira** (área Arquivos → Lixeira → Restaurar).

## Cópias de segurança

Área **Arquivos**:

- **Fazer cópia agora** grava um `.zip` em `project-backups/` com todos os projetos (com texturas,
  ícones e animações) e as configurações.
- **Salvar cópia em…** grava onde você escolher (pergunta antes de substituir um arquivo).
- **Cópia automática**: a cada 1, 3, 7, 14 ou 30 dias (padrão: semanal), ao abrir o launcher. As 5
  automáticas mais recentes ficam; as manuais nunca são apagadas pelo launcher.
- **Restaurar** cria **projetos novos** a partir da cópia: nenhum projeto atual é apagado ou
  substituído, e as configurações atuais ficam como estão.

O `.zip` é comum: dá para abrir em qualquer programa de compactação.

## Nada é sobrescrito sem perguntar

Exportar textura, ícone, `.scd` do mapa ou cópia de segurança para uma pasta onde o arquivo já existe
pede confirmação. Gerar o mundo de novo pergunta antes de trocar a massa que você colocou à mão.

## Modo local

Sistema → Configurações → **Modo local** desliga tudo que usa a rede: hub de mods, servidor da
comunidade (salas e chat) e a busca de atualizações do launcher e dos mods. As ferramentas de criação
não dependem de rede em nenhum modo.
