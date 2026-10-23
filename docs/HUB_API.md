# Hub de mods — formato do índice

O launcher lê o hub do **servidor da comunidade** (`<servidor>/hub/index.json`, gerado pelo
`cp-server` a partir de uma pasta) e, opcionalmente, outros **índices JSON** configurados em
*Configurações → Hub de mods*. Qualquer site pode publicar um índice: um arquivo estático já basta.
O launcher cuida de baixar, verificar e instalar.

* Só **HTTPS** (HTTP é aceito apenas em `localhost`, para testes).
* Índice com no máximo 8 MB; pacotes com no máximo 4 GB.
* Todo pacote é conferido por **tamanho e SHA-256** durante o download. Se não bater,
  o arquivo é descartado e nada é instalado.

O launcher busca os índices ao abrir o hub e no botão *Atualizar lista*; um cache de alguns
minutos no servidor é suficiente.

## `index.json`

```jsonc
{
  "schema": 1,                       // obrigatório; versão do formato
  "name": "Hub da comunidade SC2",
  "updatedAt": "2026-10-23T18:00:00Z",
  "mods": [
    {
      "id": "storm",                 // único no índice; minúsculas, números e "-"
      "name": "STORM Rework",
      "summary": "Uma linha para a lista.",
      "description": "Texto longo (opcional).",
      "authors": ["Comunidade STORM"],
      "category": "gameplay",        // gameplay | balance | maps | textures | ui | models | audio | fixes | library | other
      "tags": ["rework"],
      "homepage": "https://…",       // opcional
      "icon": "https://…/icon.png",  // opcional (quadrado, 256 px)
      "screenshots": ["https://…"],  // opcional
      "downloads": 1840,             // opcional, só exibição
      "rating": 4.7,                 // opcional, 0–5
      "license": "MIT",              // opcional
      "versions": [
        {
          "version": "3.2.0",        // semver tolerante: "1", "1.2", "v1.2.3-beta"
          "releasedAt": "2026-10-20T12:00:00Z",
          "changelog": "O que mudou.",
          "requiresDlc": true,       // Infinite War Battle Pack
          "multiplayer": "sync",     // sync = todos precisam ter | local = só visual
          "dependencies": [{ "id": "modsupport", "version": ">=7" }],
          "conflicts": ["revamp-rve"],
          "package": {
            "url": "pkg/storm-3.2.0.zip",   // absoluta ou relativa ao índice
            "sha256": "64 caracteres hex",
            "size": 48000000,               // bytes exatos
            "kind": "zip",                  // "zip" ou "scd"
            "fileName": "zz_STORM.scd"      // obrigatório quando kind = "scd"
          }
        }
      ]
    }
  ]
}
```

## Pacotes

**`kind: "scd"`** — um único arquivo `.scd`, instalado com o nome de `fileName`.

**`kind: "zip"`** — um `.zip` contendo um ou mais `.scd` (em qualquer pasta) e, opcionalmente,
um `mod.json` e `icon.png`. Se o `mod.json` declarar hashes, eles precisam bater com os
arquivos do pacote. O Estúdio gera esse pacote pronto em *Meus projetos → Exportar pacote*.

## `mod.json` (manifesto do mod)

```jsonc
{
  "schema": 1,
  "id": "hud-safira",
  "name": "HUD Safira",
  "version": "1.2.0",
  "authors": ["RiqueBitt"],
  "description": "",
  "category": "ui",
  "tags": [],
  "requiresDlc": false,
  "files": [{ "name": "zz_hud_safira.scd", "sha256": "…", "size": 3870000 }],
  "dependencies": [],
  "conflicts": [],
  "multiplayer": "local",
  "icon": "icon.png"
}
```

Regras de nomes de arquivo: só `.scd`, sem `/`, `\`, `..` ou `:`. Use `zz_` no começo
para carregar depois dos arquivos do jogo (e sobrescrevê-los) e `_` para carregar antes.

## Publicando um mod

**No servidor da comunidade (mais simples)**

1. No Estúdio, gere o mod e clique em **Exportar pacote** (`.zip`).
2. Coloque o pacote em `hub/mods/<id>/<versão>/` e, na primeira vez, um `hub/mods/<id>/mod.json`
   com nome, resumo, autores e categoria (veja [`server-example/hub`](../server-example/hub)).
3. Pronto: o `cp-server` calcula SHA-256 e tamanho sozinho e relê a pasta a cada ~5 minutos.
   Para conferir antes, `cp hub-build hub/` mostra o índice gerado e os avisos.

**Em um índice próprio**

1. Exporte o pacote como acima.
2. Calcule o SHA-256 e o tamanho (`sha256sum pacote.zip` / `Get-FileHash pacote.zip`), ou gere o
   índice inteiro com `cp hub-build <pasta> index.json`.
3. Hospede o `.zip` e o `index.json` em qualquer lugar com HTTPS (GitHub Releases, um bucket, seu site).

**Link direto**: para compartilhar um mod sem hub, mande o link do `.scd`/`.zip`. No launcher,
*Conteúdo → Instalar de um link* (ou `cp link <url>`) baixa, valida e importa. Links que devolvem
uma página HTML em vez do arquivo são recusados.

Um exemplo completo está em [`hub/example-index.json`](../hub/example-index.json).
